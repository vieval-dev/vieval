import type { TaskReporterHooks } from '../config'
import type { CliProjectConfig } from './config'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'

import { loadEnv, loadVievalCliConfig } from './config'

const temporaryDirectories: string[] = []

describe('loadVievalCliConfig', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(async (temporaryDirectory) => {
        await rm(temporaryDirectory, { force: true, recursive: true })
      }),
    )
    temporaryDirectories.length = 0
  })

  it('returns default project when no config file exists', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.configFilePath).toBeNull()
    expect(loaded.projects).toHaveLength(1)
    expect(loaded.projects[0].name).toBe('default')
  })

  it('loads nearest config file and normalizes project root', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const nestedDirectory = join(temporaryDirectory, 'nested', 'deep')
    await mkdir(nestedDirectory, { recursive: true })

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            name: 'fixture-project',
            root: './nested',
            include: ['**/*.eval.ts'],
            exclude: ['**/ignore/**'],
          },
        ],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: nestedDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.projects).toHaveLength(1)
    expect(loaded.projects[0].root).toBe(join(temporaryDirectory, 'nested'))
    expect(loaded.projects[0].include).toEqual(['**/*.eval.ts'])
  })

  it('normalizes workspace mode into projects with inherited models and config-relative roots', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configDirectory = join(temporaryDirectory, 'config')
    await mkdir(configDirectory, { recursive: true })

    const configFilePath = join(configDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        concurrency: {
          case: 3,
          task: 2,
          workspace: 1,
        },
        models: [
          {
            id: 'openai/gpt-5-mini',
            inferenceExecutor: 'openai',
            inferenceExecutorId: 'openai',
            model: 'openai/gpt-5-mini',
          },
        ],
        reporters: ['./workspace-reporter.js'],
        workspaces: [
          {
            id: 'workspace-a',
            root: '../workspace-a',
          },
          {
            id: 'workspace-b',
            root: './nested/workspace-b',
          },
        ],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: configDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.projects).toHaveLength(2)
    expect(loaded.projects.map(project => project.name)).toEqual(['workspace-a', 'workspace-b'])
    expect(loaded.projects.map(project => project.root)).toEqual([
      join(temporaryDirectory, 'workspace-a'),
      join(configDirectory, 'nested', 'workspace-b'),
    ])
    expect(loaded.projects.map(project => project.models.map(model => model.id))).toEqual([
      ['openai/gpt-5-mini'],
      ['openai/gpt-5-mini'],
    ])
    expect(loaded.projects.map(project => project.concurrency)).toEqual([
      {
        attempt: undefined,
        case: 3,
        project: undefined,
        task: 2,
      },
      {
        attempt: undefined,
        case: 3,
        project: undefined,
        task: 2,
      },
    ])
    expect(loaded.projects.map(project => project.reporters)).toEqual([
      ['./workspace-reporter.js'],
      ['./workspace-reporter.js'],
    ])
  })

  it('throws when multiple top-level config modes are declared', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    await writeFile(
      join(temporaryDirectory, 'vieval.config.json'),
      JSON.stringify({
        projects: [{ name: 'fixture-project' }],
        workspaces: [{ id: 'fixture-workspace', root: './fixture-workspace' }],
      }),
      'utf-8',
    )

    await expect(loadVievalCliConfig({
      cwd: temporaryDirectory,
    })).rejects.toThrow('top-level keys are mutually exclusive')

    await writeFile(
      join(temporaryDirectory, 'vieval.config.json'),
      JSON.stringify({
        comparisons: [
          {
            benchmark: {
              id: 'benchmark',
              sharedCaseNamespace: 'benchmark',
            },
            id: 'comparison',
          },
        ],
        workspaces: [{ id: 'fixture-workspace', root: './fixture-workspace' }],
      }),
      'utf-8',
    )

    await expect(loadVievalCliConfig({
      cwd: temporaryDirectory,
    })).rejects.toThrow('top-level keys are mutually exclusive')
  })

  it('loads top-level env map from config', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        env: {
          VIEVAL_TEST_ENV_KEY: 'from-config',
        },
        projects: [{ name: 'fixture-project' }],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.env.VIEVAL_TEST_ENV_KEY).toBe('from-config')
  })

  it('uses one default inferenceExecutor when only models are configured', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        models: [
          {
            id: 'openai/gpt-5-mini',
            inferenceExecutor: 'openai',
            inferenceExecutorId: 'openai',
            model: 'openai/gpt-5-mini',
          },
          {
            id: 'openai/gpt-5-nano',
            inferenceExecutor: 'openai',
            inferenceExecutorId: 'openai',
            model: 'openai/gpt-5-nano',
          },
        ],
        projects: [{ name: 'fixture-project' }],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.projects[0]?.models.map(model => model.id)).toEqual([
      'openai/gpt-5-mini',
      'openai/gpt-5-nano',
    ])
    expect(loaded.projects[0]?.inferenceExecutors).toEqual([{ id: 'default' }])
  })

  it('applies project-local plugins after inherited project defaults', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.mjs')
    await writeFile(
      configFilePath,
      [
        'const model = (id) => ({',
        '  aliases: [],',
        '  id,',
        '  inferenceExecutor: "test",',
        '  inferenceExecutorId: "test",',
        '  model: id,',
        '})',
        '',
        'const topLevelModelPlugin = {',
        '  name: "top-level-model-plugin",',
        '  configVieval(config) {',
        '    return {',
        '      ...config,',
        '      models: [',
        '        ...(config.models ?? []),',
        '        model("top-level-plugin:model"),',
        '      ],',
        '    }',
        '  },',
        '}',
        '',
        'const projectModelPlugin = {',
        '  name: "project-model-plugin",',
        '  configVieval(config) {',
        '    return {',
        '      ...config,',
        '      models: [',
        '        ...(config.models ?? []),',
        '        model("project-local:model"),',
        '      ],',
        '    }',
        '  },',
        '}',
        '',
        'export default {',
        '  concurrency: { task: 4, workspace: 2 },',
        '  models: [model("global:model")],',
        '  plugins: [topLevelModelPlugin],',
        '  projects: [',
        '    {',
        '      concurrency: { case: 9 },',
        '      name: "with-project-plugin",',
        '      plugins: [projectModelPlugin],',
        '    },',
        '    {',
        '      name: "without-project-plugin",',
        '    },',
        '    {',
        '      models: [model("explicit-project:model")],',
        '      name: "explicit-project-models",',
        '      plugins: [projectModelPlugin],',
        '    },',
        '  ],',
        '}',
      ].join('\n'),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.projects[0]?.models.map(model => model.id)).toEqual([
      'global:model',
      'top-level-plugin:model',
      'project-local:model',
    ])
    expect(loaded.projects[1]?.models.map(model => model.id)).toEqual([
      'global:model',
      'top-level-plugin:model',
    ])
    expect(loaded.projects[2]?.models.map(model => model.id)).toEqual([
      'explicit-project:model',
      'project-local:model',
    ])
    expect(loaded.projects[0]?.concurrency).toEqual({
      attempt: undefined,
      case: 9,
      project: undefined,
      task: 4,
    })
  })

  it('accepts runMatrix and evalMatrix layer objects', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            evalMatrix: {
              disable: ['legacy-rubric'],
              extend: {
                rubric: ['strict'],
              },
            },
            name: 'fixture-project',
            runMatrix: {
              extend: {
                model: ['gpt-4.1-mini'],
              },
              override: {
                model: ['gpt-4.1'],
              },
            },
          },
        ],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.projects[0].runMatrix).toEqual({
      extend: {
        model: ['gpt-4.1-mini'],
      },
      override: {
        model: ['gpt-4.1'],
      },
    })
    expect(loaded.projects[0].evalMatrix).toEqual({
      disable: ['legacy-rubric'],
      extend: {
        rubric: ['strict'],
      },
    })
  })

  it('inherits global reporter references and allows project overrides', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            name: 'inherits-reporters',
          },
          {
            name: 'overrides-reporters',
            reporters: ['./custom-reporter.js'],
          },
        ],
        reporters: [['./global-reporter.js', { verbose: true }]],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.projects[0]?.reporters).toEqual([
      ['./global-reporter.js', { verbose: true }],
    ])
    expect(loaded.projects[1]?.reporters).toEqual(['./custom-reporter.js'])
  })

  it('merges project concurrency overrides with inherited top-level defaults field by field', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        concurrency: {
          attempt: 5,
          case: 6,
          project: 3,
          task: 4,
          workspace: 2,
        },
        projects: [
          {
            concurrency: {
              case: 9,
            },
            name: 'fixture-project',
          },
        ],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.concurrency).toEqual({
      attempt: 5,
      case: 6,
      project: 3,
      task: 4,
      workspace: 2,
    })
    expect(loaded.projects[0]?.concurrency).toEqual({
      attempt: 5,
      case: 9,
      project: 3,
      task: 4,
    })
  })

  it('normalizes flat runMatrix shorthand to a layered extend object', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            name: 'fixture-project',
            runMatrix: {
              scenario: ['default'],
            },
          },
        ],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.projects[0].runMatrix).toEqual({
      extend: {
        scenario: ['default'],
      },
    })
  })

  it('normalizes flat evalMatrix shorthand to a layered extend object', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            evalMatrix: {
              rubric: ['strict'],
            },
            name: 'fixture-project',
          },
        ],
      }),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.configFilePath).toBe(configFilePath)
    expect(loaded.projects[0].evalMatrix).toEqual({
      extend: {
        rubric: ['strict'],
      },
    })
  })

  /**
   * @example
   * it('normalizes open telemetry reporting config') verifies enabled reporting config survives c12 loading.
   */
  it('normalizes open telemetry reporting config', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.mjs')
    await writeFile(
      configFilePath,
      [
        'export default {',
        '  reporting: {',
        '    openTelemetry: {',
        '      enabled: true,',
        '      onRunEnd: async () => {},',
        '    },',
        '  },',
        '  projects: [{ name: "fixture-project" }],',
        '}',
      ].join('\n'),
      'utf-8',
    )

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.reporting?.openTelemetry?.enabled).toBe(true)
    expect(loaded.reporting?.openTelemetry?.onRunEnd).toEqual(expect.any(Function))
  })

  /**
   * @example
   * it('leaves reporting disabled by default') documents deterministic file reporting without OTel.
   */
  it('leaves reporting disabled by default', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const loaded = await loadVievalCliConfig({
      cwd: temporaryDirectory,
    })

    expect(loaded.reporting?.openTelemetry?.enabled ?? false).toBe(false)
  })

  it('throws for ambiguous mixed-key runMatrix config objects', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    const configFilePath = join(temporaryDirectory, 'vieval.config.json')
    await writeFile(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            name: 'fixture-project',
            runMatrix: {
              disable: ['legacy-scenario'],
              scenario: ['default'],
            },
          },
        ],
      }),
      'utf-8',
    )

    await expect(loadVievalCliConfig({
      cwd: temporaryDirectory,
    })).rejects.toThrow('Ambiguous matrix definition')
  })

  it('loads mode-specific env values through cli config helper', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-cli-config-'))
    temporaryDirectories.push(temporaryDirectory)

    await writeFile(
      join(temporaryDirectory, '.env.test'),
      [
        'VIEVAL_TEST_ENV_KEY=from-dotenv',
      ].join('\n'),
      'utf-8',
    )

    const env = loadEnv('test', temporaryDirectory, '')
    expect(env.VIEVAL_TEST_ENV_KEY).toBe('from-dotenv')
  })

  /**
   * @example
   * it('exposes reporterHooks on project executor context', () => {})
   */
  it('exposes reporterHooks on project executor context', () => {
    type ProjectExecutor = NonNullable<CliProjectConfig['executor']>
    type ProjectExecutorContext = Parameters<ProjectExecutor>[1]

    expectTypeOf<ProjectExecutorContext['reporterHooks']>().toEqualTypeOf<TaskReporterHooks | undefined>()
  })
})

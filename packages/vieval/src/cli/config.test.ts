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

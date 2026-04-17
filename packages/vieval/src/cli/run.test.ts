import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatVievalCliRunOutput, runVievalCli } from './run'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const fixtureProjectDirectory = join(packageDirectory, 'tests', 'projects', 'example-pattern-byoa-bring-your-own-agent')
const taskProjectDirectory = join(packageDirectory, 'tests', 'projects', 'example-api-defining-new-task')
const temporaryDirectories: string[] = []

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value)
}

async function createDslTaskProject(): Promise<string> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-live-reporter-'))
  temporaryDirectories.push(temporaryDirectory)

  const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')

  await mkdir(join(temporaryDirectory, 'evals'), { recursive: true })
  await writeFile(
    join(temporaryDirectory, 'evals', 'live-task.eval.ts'),
    `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('live-task', () => {
  caseOf('live-case', () => {}, {
    source: 'live-case',
  })
})
`,
    'utf-8',
  )
  await writeFile(
    join(temporaryDirectory, 'vieval.config.ts'),
    `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      model: 'gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai:gpt-4.1-mini',
    },
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'live-project',
      root: '.',
    },
  ],
})
`,
    'utf-8',
  )

  return temporaryDirectory
}

async function createDslProject(options: {
  evalFiles: Record<string, string>
  executorSource?: string
  projectName: string
}): Promise<string> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-task-project-'))
  temporaryDirectories.push(temporaryDirectory)

  const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
  const executorBlock = options.executorSource == null
    ? ''
    : `executor: ${options.executorSource},`

  await mkdir(join(temporaryDirectory, 'evals'), { recursive: true })

  await Promise.all(
    Object.entries(options.evalFiles).map(async ([fileName, source]) => {
      await writeFile(join(temporaryDirectory, 'evals', fileName), source, 'utf-8')
    }),
  )

  await writeFile(
    join(temporaryDirectory, 'vieval.config.ts'),
    `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      model: 'gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai:gpt-4.1-mini',
    },
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: '${options.projectName}',
      root: '.',
      ${executorBlock}
    },
  ],
})
`,
    'utf-8',
  )

  return temporaryDirectory
}

describe('runVievalCli', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(async (temporaryDirectory) => {
        await rm(temporaryDirectory, { force: true, recursive: true })
      }),
    )
    temporaryDirectories.length = 0
  })

  it('collects and schedules evals when config provides no executor', async () => {
    const output = await runVievalCli({
      configFilePath: join(fixtureProjectDirectory, 'vieval.config.json'),
      cwd: fixtureProjectDirectory,
    })

    expect(output.projects).toHaveLength(1)
    expect(output.projects[0]).toMatchObject({
      discoveredEvalFileCount: 2,
      entryCount: 2,
      errorMessage: null,
      executed: false,
      name: 'example-pattern-byoa-bring-your-own-agent',
      taskCount: 2,
    })
    expect(output.projects[0]?.matrixSummary).not.toBeNull()
  })

  it('executes scheduled tasks when project defines executor', async () => {
    const output = await runVievalCli({
      configFilePath: join(fixtureProjectDirectory, 'vieval.exec.config.cjs'),
      cwd: fixtureProjectDirectory,
    })

    expect(output.projects).toHaveLength(1)
    expect(output.projects[0].executed).toBe(true)
    expect(output.projects[0].result?.overall.runCount).toBe(2)
    expect(output.projects[0].result?.overall.hybridAverage).toBe(1)
  })

  it('writes report artifacts under workspace/project/experiment/attempt/run layout', async () => {
    const reportOut = await mkdtemp(join(tmpdir(), 'vieval-report-out-'))
    temporaryDirectories.push(reportOut)

    const output = await runVievalCli({
      attempt: 'attempt-1',
      configFilePath: join(fixtureProjectDirectory, 'vieval.exec.config.cjs'),
      cwd: fixtureProjectDirectory,
      experiment: 'baseline',
      reportOut,
      workspace: 'packages-vieval',
    })

    expect(output.reportDirectory).toBeDefined()
    expect(output.reportDirectory).toContain('/packages-vieval/example-pattern-byoa-bring-your-own-agent-exec/baseline/attempt-1/')

    const summaryText = await readFile(join(output.reportDirectory!, 'run-summary.json'), 'utf-8')
    const eventsText = await readFile(join(output.reportDirectory!, 'events.jsonl'), 'utf-8')

    expect(summaryText).toContain('"workspaceId": "packages-vieval"')
    expect(summaryText).toContain('"experimentId": "baseline"')
    expect(summaryText).toContain('"attemptId": "attempt-1"')
    expect(eventsText.length).toBeGreaterThan(0)
  })

  it('persists task-emitted custom telemetry events into report artifacts', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const reportOut = await mkdtemp(join(tmpdir(), 'vieval-report-telemetry-'))
    temporaryDirectories.push(reportOut)

    const projectDirectory = await createDslProject({
      evalFiles: {
        'custom-telemetry.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('custom-telemetry-task', () => {
  caseOf('custom-telemetry-case', (context) => {
    context.reporterHooks?.onEvent?.({
      caseId: 'custom-telemetry-case',
      data: {
        metering: {
          dimensions: {
            input_tokens: 12,
            output_tokens: 6,
            total_tokens: 18,
            tool_call_count: 1,
          },
        },
        toolCalls: [
          {
            args: { city: 'tokyo' },
            name: 'weather.lookup',
          },
        ],
      },
      event: 'InferenceResponse',
    })
  }, undefined)
})
`,
      },
      projectName: 'custom-telemetry-project',
    })

    const output = await runVievalCli({
      attempt: 'attempt-telemetry',
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      experiment: 'tool-calls',
      reportOut,
      workspace: 'ws-telemetry',
    })

    expect(output.reportDirectory).toBeDefined()

    const eventsText = await readFile(join(output.reportDirectory!, 'events.jsonl'), 'utf-8')
    const events = eventsText
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as {
        caseId?: string
        data?: {
          metering?: {
            dimensions?: Record<string, number>
          }
          toolCalls?: Array<{
            name: string
          }>
        }
        event: string
        projectId?: string
        taskId?: string
      })
    const telemetryEvent = events.find(event => event.event === 'InferenceResponse')

    expect(telemetryEvent).toBeDefined()
    expect(telemetryEvent?.taskId).toBeDefined()
    expect(telemetryEvent?.projectId).toBe('custom-telemetry-project')
    expect(telemetryEvent?.caseId).toBe('custom-telemetry-case')
    expect(telemetryEvent?.data?.metering?.dimensions?.tool_call_count).toBe(1)
    expect(telemetryEvent?.data?.toolCalls?.[0]?.name).toBe('weather.lookup')
  })

  it('preserves scoped scheduled matrix artifacts in CLI output', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await createDslProject({
      evalFiles: {
        'scoped-matrix.eval.ts': `
import { describeTask } from '${vievalImportPath}'

describeTask('scoped-matrix', () => {
})
`,
      },
      projectName: 'scoped-matrix-project',
    })

    await writeFile(
      join(projectDirectory, 'vieval.config.ts'),
      `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      model: 'gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai:gpt-4.1-mini',
    },
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'scoped-matrix-project',
      root: '.',
      executor: async (task, context) => {
        if (task.entry.task == null) {
          throw new Error(\`Missing eval task definition for entry "\${task.entry.id}".\`)
        }

        const output = await task.entry.task.run({
          model: context.model,
          reporterHooks: context.reporterHooks,
          task,
        })

        return {
          entryId: task.entry.id,
          id: task.id,
          matrix: {
            legacy: 'shape',
          },
          inferenceExecutorId: task.inferenceExecutor.id,
          scores: [...output.scores],
        }
      },
      runMatrix: {
        extend: {
          model: ['gpt-4.1-mini'],
          scenario: ['baseline'],
        },
      },
      evalMatrix: {
        extend: {
          rubric: ['strict'],
        },
      },
    },
  ],
})
`,
      'utf-8',
    )

    const output = await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
    })

    expect(output.projects[0]?.result?.runs[0]?.matrix).toEqual({
      eval: {
        rubric: 'strict',
      },
      meta: {
        evalRowId: 'rubric=strict',
        runRowId: 'model=gpt-4.1-mini&scenario=baseline',
      },
      run: {
        model: 'gpt-4.1-mini',
        scenario: 'baseline',
      },
    })
  })

  it('formats output summary for terminal usage', async () => {
    const output = await runVievalCli({
      configFilePath: join(fixtureProjectDirectory, 'vieval.config.json'),
      cwd: fixtureProjectDirectory,
    })
    const summary = formatVievalCliRunOutput(output)

    expect(summary).toContain('RUN  vieval')
    expect(summary).toContain('○ |example-pattern-byoa-bring-your-own-agent|')
    expect(summary).toContain('(2 tasks)')
    expect(summary).toContain('Projects  0 passed | 1 skipped (1)')
    expect(summary).toContain('Tasks     0 executed / 2 scheduled')
  })

  it('reports skipped/passed/failed counts together when mixed', () => {
    const summary = formatVievalCliRunOutput({
      configFilePath: '/tmp/vieval.config.ts',
      projects: [
        {
          discoveredEvalFileCount: 1,
          entryCount: 1,
          errorMessage: null,
          executed: true,
          matrixSummary: null,
          name: 'passed-project',
          result: {
            overall: {
              exactAverage: 1,
              hybridAverage: 1,
              judgeAverage: null,
              runCount: 1,
            },
            inferenceExecutors: [],
            runs: [],
          },
          taskCount: 1,
        },
        {
          discoveredEvalFileCount: 2,
          entryCount: 2,
          errorMessage: null,
          executed: false,
          matrixSummary: null,
          name: 'skipped-project',
          result: null,
          taskCount: 2,
        },
        {
          discoveredEvalFileCount: 0,
          entryCount: 0,
          errorMessage: 'failed-project-error',
          executed: false,
          matrixSummary: null,
          name: 'failed-project',
          result: null,
          taskCount: 0,
        },
      ],
    })

    expect(summary).toContain('✓ |passed-project|')
    expect(summary).toContain('○ |skipped-project|')
    expect(summary).toContain('❯ |failed-project|')
    expect(summary).toContain('Projects  1 passed | 1 skipped | 1 failed (3)')
    expect(summary).toContain('Tasks     1 executed / 3 scheduled')
  })

  it('executes module-defined eval tasks without project executor', async () => {
    const output = await runVievalCli({
      configFilePath: join(taskProjectDirectory, 'vieval.config.ts'),
      cwd: taskProjectDirectory,
    })

    expect(output.projects).toHaveLength(1)
    expect(output.projects[0]).toMatchObject({
      executed: true,
      name: 'example-api-defining-new-task',
    })
    expect(output.projects[0]?.matrixSummary).not.toBeNull()
    expect(output.projects[0].result?.overall.runCount).toBe(2)
    expect(output.projects[0].result?.overall.hybridAverage).toBe(1)
  })

  it('includes case pass/fail counts in executed project summary lines', async () => {
    const output = await runVievalCli({
      configFilePath: join(taskProjectDirectory, 'vieval.config.ts'),
      cwd: taskProjectDirectory,
    })
    const summary = formatVievalCliRunOutput(output)

    expect(summary).toContain('cases 1 passed | 0 failed')
    expect(summary).toContain('matrix run ')
  })

  it('shows schedule breakdown when project task count is a clean matrix cross-product', () => {
    const summary = formatVievalCliRunOutput({
      configFilePath: '/tmp/vieval.config.ts',
      projects: [
        {
          discoveredEvalFileCount: 3,
          entryCount: 3,
          errorMessage: null,
          executed: true,
          matrixSummary: {
            evalAxes: ['rubric', 'rubricModel'],
            evalRows: 4,
            runAxes: ['model', 'promptLanguage', 'scenario'],
            runRows: 8,
          },
          name: 'example-api-config-matrix',
          result: {
            overall: {
              exactAverage: 1,
              hybridAverage: 1,
              judgeAverage: null,
              runCount: 288,
            },
            inferenceExecutors: [],
            runs: [],
          },
          taskCount: 288,
        },
      ],
    })

    expect(stripAnsi(summary)).toContain('schedule 3 entries × 3 inferenceExecutors × 8 run rows × 4 eval rows = 288 tasks')
  })

  it('applies config env during execution and restores process env afterwards', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-run-env-'))
    temporaryDirectories.push(temporaryDirectory)

    const evalConfigImportPath = join(packageDirectory, 'src', 'config', 'index.ts').replaceAll('\\', '/')
    const cliConfigImportPath = join(packageDirectory, 'src', 'cli', 'config.ts').replaceAll('\\', '/')

    const evalsDirectory = join(temporaryDirectory, 'evals')
    await mkdir(evalsDirectory, { recursive: true })
    await writeFile(
      join(evalsDirectory, 'env.eval.ts'),
      `
import { defineEval, defineTask } from '${evalConfigImportPath}'

export default defineEval({
  name: 'env-eval',
  description: 'ensures env injection',
  task: defineTask({
    id: 'env-task',
    run() {
      const score = process.env.VIEVAL_TEST_ENV_KEY === 'from-config' ? 1 : 0
      return {
        scores: [
          {
            kind: 'exact',
            score,
          },
        ],
      }
    },
  }),
})
`,
      'utf-8',
    )
    await writeFile(
      join(temporaryDirectory, 'vieval.config.ts'),
      `
import { defineConfig } from '${cliConfigImportPath}'

export default defineConfig({
  env: {
    VIEVAL_TEST_ENV_KEY: 'from-config',
  },
  projects: [
    {
      name: 'env-project',
      root: '.',
      include: ['evals/*.eval.ts'],
      exclude: [],
      models: [
        {
          id: 'openai:gpt-4.1-mini',
          inferenceExecutorId: 'openai',
          inferenceExecutor: 'openai',
          model: 'gpt-4.1-mini',
          aliases: [],
        },
      ],
    },
  ],
})
`,
      'utf-8',
    )

    const previousEnv = process.env.VIEVAL_TEST_ENV_KEY
    process.env.VIEVAL_TEST_ENV_KEY = 'outside-value'

    const output = await runVievalCli({
      configFilePath: join(temporaryDirectory, 'vieval.config.ts'),
      cwd: temporaryDirectory,
    })

    expect(output.projects).toHaveLength(1)
    expect(output.projects[0].errorMessage).toBeNull()
    expect(output.projects[0].executed).toBe(true)
    expect(output.projects[0].result?.overall.hybridAverage).toBe(1)
    expect(process.env.VIEVAL_TEST_ENV_KEY).toBe('outside-value')

    if (previousEnv == null) {
      delete process.env.VIEVAL_TEST_ENV_KEY
      return
    }
    process.env.VIEVAL_TEST_ENV_KEY = previousEnv
  })

  /**
   * @example
   * it('emits live reporter rows with task and case counters when stdout is a TTY', async () => {})
   */
  it('emits live reporter rows with task and case counters when stdout is a TTY', async () => {
    const projectDirectory = await createDslTaskProject()
    const writes: string[] = []
    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    const originalStdoutIsTTY = process.stdout.isTTY
    const originalStdoutColumns = process.stdout.columns
    const originalStderrIsTTY = process.stderr.isTTY

    const stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
        return true
      }) as typeof process.stdout.write)

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 120,
    })
    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: true,
    })

    try {
      await runVievalCli({
        configFilePath: join(projectDirectory, 'vieval.config.ts'),
        cwd: projectDirectory,
        reporter: {
          clearInterval: () => {},
          createInterval: () => ({ unref() {} }),
          queueRenderReset(callback) {
            callback()
          },
        },
      })
    }
    finally {
      stdoutWriteSpy.mockRestore()

      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalStdoutIsTTY,
      })
      Object.defineProperty(process.stdout, 'columns', {
        configurable: true,
        value: originalStdoutColumns,
      })
      Object.defineProperty(process.stderr, 'isTTY', {
        configurable: true,
        value: originalStderrIsTTY,
      })
      process.stdout.write = originalStdoutWrite
    }

    const terminalOutput = stripAnsi(writes.join(''))

    /**
     * @example
     * expect(terminalOutput).toContain('❯')
     */
    expect(terminalOutput).toContain('❯')
    /**
     * @example
     * expect(terminalOutput).toContain('live-task')
     */
    expect(terminalOutput).toContain('live-task')
    /**
     * @example
     * expect(terminalOutput).toContain('0/1')
     */
    expect(terminalOutput).toContain('0/1')
    /**
     * @example
     * expect(terminalOutput).toContain('Tasks')
     */
    expect(terminalOutput).toContain('Tasks')
    /**
     * @example
     * expect(terminalOutput).toContain('Cases')
     */
    expect(terminalOutput).toContain('Cases')
    /**
     * @example
     * expect(terminalOutput).toContain('(1)')
     */
    expect(terminalOutput).toContain('(1)')
  })

  /**
   * @example
   * it('threads case reporter hooks through custom project executors', async () => {})
   */
  it('threads case reporter hooks through custom project executors', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await createDslProject({
      evalFiles: {
        'custom-executor.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('custom-live-task', () => {
  caseOf('custom-case', () => {}, {
    source: 'custom-case',
  })
})
`,
      },
      executorSource: `async (task, context) => {
        if (task.entry.task == null) {
          throw new Error(\`Missing eval task definition for entry "\${task.entry.id}".\`)
        }

        const output = await task.entry.task.run({
          model: context.model,
          reporterHooks: context.reporterHooks,
          task,
        })

        return {
          entryId: task.entry.id,
          id: task.id,
          matrix: task.matrix,
          inferenceExecutorId: task.inferenceExecutor.id,
          scores: [...output.scores],
        }
      }`,
      projectName: 'custom-executor-project',
    })
    const writes: string[] = []
    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    const originalStdoutIsTTY = process.stdout.isTTY
    const originalStdoutColumns = process.stdout.columns
    const originalStderrIsTTY = process.stderr.isTTY

    const stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
        return true
      }) as typeof process.stdout.write)

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(process.stdout, 'columns', {
      configurable: true,
      value: 120,
    })
    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: true,
    })

    try {
      await runVievalCli({
        configFilePath: join(projectDirectory, 'vieval.config.ts'),
        cwd: projectDirectory,
        reporter: {
          clearInterval: () => {},
          createInterval: () => ({ unref() {} }),
          queueRenderReset(callback) {
            callback()
          },
        },
      })
    }
    finally {
      stdoutWriteSpy.mockRestore()

      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalStdoutIsTTY,
      })
      Object.defineProperty(process.stdout, 'columns', {
        configurable: true,
        value: originalStdoutColumns,
      })
      Object.defineProperty(process.stderr, 'isTTY', {
        configurable: true,
        value: originalStderrIsTTY,
      })
      process.stdout.write = originalStdoutWrite
    }

    const terminalOutput = stripAnsi(writes.join(''))

    expect(terminalOutput).toContain('0/1')
    expect(terminalOutput).toContain('Cases    1 passed | 0 failed | 0 skipped (1)')
  })

  /**
   * @example
   * it('classifies start-hook failures on the triggering task and keeps final counters accurate', async () => {})
   */
  it('classifies start-hook failures on the triggering task and keeps final counters accurate', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await createDslProject({
      evalFiles: {
        'first.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('first-task', () => {
  caseOf('first-case', () => {}, {
    source: 'first-case',
  })
})
`,
        'second.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('second-task', () => {
  caseOf('second-case', () => {}, {
    source: 'second-case',
  })
})
`,
      },
      projectName: 'start-hook-failure-project',
    })
    const reporterEvents: Array<{ payload: unknown, type: string }> = []
    let taskStartCount = 0

    vi.resetModules()
    vi.doMock('./reporters', () => ({
      createCliReporter: () => ({
        dispose() {
          reporterEvents.push({ payload: undefined, type: 'dispose' })
        },
        onCaseEnd(payload: unknown) {
          reporterEvents.push({ payload, type: 'case-end' })
        },
        onCaseStart(payload: unknown) {
          reporterEvents.push({ payload, type: 'case-start' })
        },
        onRunEnd(payload: unknown) {
          reporterEvents.push({ payload, type: 'run-end' })
        },
        onRunStart(payload: unknown) {
          reporterEvents.push({ payload, type: 'run-start' })
        },
        onTaskEnd(payload: unknown) {
          reporterEvents.push({ payload, type: 'task-end' })
        },
        onTaskQueued(payload: unknown) {
          reporterEvents.push({ payload, type: 'task-queued' })
        },
        onTaskStart(payload: unknown) {
          reporterEvents.push({ payload, type: 'task-start' })
          taskStartCount += 1

          if (taskStartCount === 1) {
            throw new Error('start hook boom')
          }
        },
      }),
    }))

    try {
      const { runVievalCli: isolatedRunVievalCli } = await import('./run')
      const output = await isolatedRunVievalCli({
        configFilePath: join(projectDirectory, 'vieval.config.ts'),
        cwd: projectDirectory,
      })
      const queuedTaskIds = reporterEvents
        .filter(event => event.type === 'task-queued')
        .map(event => (event.payload as { taskId: string }).taskId)
      const taskEndEvents = reporterEvents
        .filter(event => event.type === 'task-end')
        .map(event => event.payload as { state: string, taskId: string })
      const runEndPayload = reporterEvents.find(event => event.type === 'run-end')?.payload as {
        failedTasks: number
        passedTasks: number
        skippedTasks: number
        totalTasks: number
      }

      expect(queuedTaskIds).toHaveLength(2)
      expect(output.projects[0]).toMatchObject({
        discoveredEvalFileCount: 2,
        entryCount: 2,
        errorMessage: `Runner task "${queuedTaskIds[0]}" failed: start hook boom`,
        executed: false,
        name: 'start-hook-failure-project',
        taskCount: 2,
      })
      expect(taskEndEvents).toEqual([
        {
          state: 'failed',
          taskId: queuedTaskIds[0],
        },
        {
          state: 'skipped',
          taskId: queuedTaskIds[1],
        },
      ])
      expect(runEndPayload).toMatchObject({
        failedTasks: 1,
        passedTasks: 0,
        skippedTasks: 1,
        totalTasks: 2,
      })
    }
    finally {
      vi.doUnmock('./reporters')
      vi.resetModules()
    }
  })

  it('does not commit passed task counters before a task end observer settles', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-run-observer-failure-'))
    temporaryDirectories.push(projectDirectory)

    await mkdir(join(projectDirectory, 'evals'), { recursive: true })
    await writeFile(
      join(projectDirectory, 'evals', 'observer.eval.ts'),
      `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('observer-task', () => {
  caseOf('observer-case', () => {}, {
    source: 'observer-case',
  })
})
`,
      'utf-8',
    )
    await writeFile(
      join(projectDirectory, 'vieval.config.ts'),
      `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      model: 'gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai:gpt-4.1-mini',
    },
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'observer-project',
      root: '.',
    },
  ],
})
`,
      'utf-8',
    )

    const reporterEvents: Array<{ payload: unknown, type: string }> = []
    let queuedTaskId: string | undefined

    vi.resetModules()
    vi.doMock('./reporters', () => ({
      createCliReporter: () => ({
        dispose() {
          reporterEvents.push({ payload: undefined, type: 'dispose' })
        },
        onCaseEnd(payload: unknown) {
          reporterEvents.push({ payload, type: 'case-end' })
        },
        onCaseStart(payload: unknown) {
          reporterEvents.push({ payload, type: 'case-start' })
        },
        onRunEnd(payload: unknown) {
          reporterEvents.push({ payload, type: 'run-end' })
        },
        onRunStart(payload: unknown) {
          reporterEvents.push({ payload, type: 'run-start' })
        },
        onTaskEnd(payload: unknown) {
          reporterEvents.push({ payload, type: 'task-end' })
          if ((payload as { state?: string }).state === 'passed') {
            throw new Error('observer end boom')
          }
        },
        onTaskQueued(payload: unknown) {
          reporterEvents.push({ payload, type: 'task-queued' })
          queuedTaskId = (payload as { taskId?: string }).taskId
        },
        onTaskStart(payload: unknown) {
          reporterEvents.push({ payload, type: 'task-start' })
        },
      }),
    }))

    try {
      const { runVievalCli: isolatedRunVievalCli } = await import('./run')
      const output = await isolatedRunVievalCli({
        configFilePath: join(projectDirectory, 'vieval.config.ts'),
        cwd: projectDirectory,
      })
      const runEndPayload = reporterEvents.find(event => event.type === 'run-end')?.payload as {
        failedTasks: number
        passedTasks: number
        skippedTasks: number
        totalTasks: number
      }

      expect(queuedTaskId).toBeDefined()
      expect(output.projects[0]).toMatchObject({
        errorMessage: `Runner task "${queuedTaskId}" failed: observer end boom`,
        executed: false,
        name: 'observer-project',
      })
      expect(runEndPayload).toMatchObject({
        failedTasks: 0,
        passedTasks: 0,
        skippedTasks: 0,
        totalTasks: 1,
      })
    }
    finally {
      vi.doUnmock('./reporters')
    }
  })

  it('reports skipped no-executor project tasks in run totals', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-run-total-semantics-'))
    temporaryDirectories.push(projectDirectory)

    await mkdir(join(projectDirectory, 'exec'), { recursive: true })
    await mkdir(join(projectDirectory, 'skipped'), { recursive: true })
    await writeFile(
      join(projectDirectory, 'exec', 'exec.eval.ts'),
      `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('exec-task', () => {
  caseOf('exec-case', () => {}, {
    source: 'exec-case',
  })
})
`,
      'utf-8',
    )
    await writeFile(
      join(projectDirectory, 'skipped', 'skipped.eval.ts'),
      `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('skipped-task', () => {
  caseOf('skipped-case', () => {}, {
    source: 'skipped-case',
  })
})
`,
      'utf-8',
    )
    await writeFile(
      join(projectDirectory, 'vieval.config.ts'),
      `
import { defineConfig } from '${vievalImportPath}'

const skippedProjectRoot = ${JSON.stringify(fixtureProjectDirectory.replaceAll('\\', '/'))}

export default defineConfig({
  models: [],
  projects: [
    {
      include: ['exec/*.eval.ts'],
      name: 'exec-project',
      root: '.',
      executor: async () => ({
        entryId: 'exec-task',
        id: 'exec-task',
        matrix: {},
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        scores: [{ kind: 'exact', score: 1 }],
      }),
    },
    {
      include: ['evals/*.eval.ts'],
      name: 'skipped-project',
      root: skippedProjectRoot,
    },
  ],
})
`,
      'utf-8',
    )

    const output = await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
    })

    expect(output.projects).toHaveLength(2)
    expect(output.projects[0]?.executed).toBe(true)
    expect(output.projects[0]?.result).not.toBeNull()
    expect(output.projects[1]?.executed).toBe(false)
    expect(formatVievalCliRunOutput(output)).toContain('Tasks     0 executed / 0 scheduled')
  })
})

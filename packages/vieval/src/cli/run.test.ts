import type { CliRunOutput } from './run'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatVievalCliRunOutput, runVievalCli } from './run'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const concurrencyCasesFromInputsProjectDirectory = join(packageDirectory, 'tests', 'projects', 'concurrency-cases-from-inputs')
const concurrencyCliOverridesProjectDirectory = join(packageDirectory, 'tests', 'projects', 'concurrency-cli-overrides')
const concurrencyExperimentMetadataProjectDirectory = join(packageDirectory, 'tests', 'projects', 'concurrency-experiment-metadata')
const concurrencyTaskProjectDirectory = join(packageDirectory, 'tests', 'projects', 'concurrency-task')
const executionPolicyAutoAttemptProjectDirectory = join(packageDirectory, 'tests', 'projects', 'execution-policy-auto-attempt')
const executionPolicyAutoRetryProjectDirectory = join(packageDirectory, 'tests', 'projects', 'execution-policy-auto-retry')
const executionPolicyTimeoutProjectDirectory = join(packageDirectory, 'tests', 'projects', 'execution-policy-timeout')
const fixtureProjectDirectory = join(packageDirectory, 'tests', 'projects', 'example-pattern-byoa-bring-your-own-agent')
const taskProjectDirectory = join(packageDirectory, 'tests', 'projects', 'example-api-defining-new-task')
const temporaryDirectories: string[] = []
const blockingRunStateKey = '__VIEVAL_BLOCKING_RUN_STATE__'
const caseConcurrencyRunStateKey = '__VIEVAL_CASE_CONCURRENCY_RUN_STATE__'
const telemetryRunEndStateKey = '__VIEVAL_TELEMETRY_RUN_END_STATE__'
const openTelemetrySpanCalls: Array<{ attributes?: Record<string, unknown>, name: string }> = []
const openTelemetryEventCalls: Array<{ attributes?: Record<string, unknown>, name: string }> = []
let activeOpenTelemetrySpan: {
  addEvent: (name: string, attributes?: Record<string, unknown>) => void
  end: () => void
  recordException: (error: unknown) => void
  setAttributes: (attributes: Record<string, unknown>) => void
  setStatus: (status: { code: number, message?: string }) => void
} | undefined
const openTelemetryApiMock = {
  SpanStatusCode: {
    ERROR: 2,
  },
  trace: {
    getActiveSpan: () => activeOpenTelemetrySpan,
    getTracer: () => ({
      async startActiveSpan<T>(
        name: string,
        options: { attributes?: Record<string, unknown> },
        callback: (span: NonNullable<typeof activeOpenTelemetrySpan>) => Promise<T>,
      ): Promise<T> {
        const span = {
          addEvent(name: string, attributes?: Record<string, unknown>) {
            openTelemetryEventCalls.push({ attributes, name })
          },
          end: vi.fn(),
          recordException: vi.fn(),
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
        }
        openTelemetrySpanCalls.push({ attributes: options.attributes, name })
        activeOpenTelemetrySpan = span
        try {
          return await callback(span)
        }
        finally {
          activeOpenTelemetrySpan = undefined
        }
      },
    }),
  },
}

vi.mock('@opentelemetry/api', () => openTelemetryApiMock)

interface BlockingRunState {
  active: number
  peak: number
  projectActive: Record<string, number>
  projectPeak: Record<string, number>
  releases: Array<() => void>
  started: string[]
}

interface BlockingProjectFixtureOptions {
  concurrencySource?: string
  evalNames: string[]
  name: string
}

interface CaseConcurrencyRunState {
  active: number
  peak: number
  releases: Array<() => void>
  started: number[]
}

function createBlockingRunState(): BlockingRunState {
  return {
    active: 0,
    peak: 0,
    projectActive: {},
    projectPeak: {},
    releases: [],
    started: [],
  }
}

function setBlockingRunState(state: BlockingRunState): void {
  ;(globalThis as typeof globalThis & {
    [blockingRunStateKey]?: BlockingRunState
  })[blockingRunStateKey] = state
}

function clearBlockingRunState(): void {
  delete (globalThis as typeof globalThis & {
    [blockingRunStateKey]?: BlockingRunState
  })[blockingRunStateKey]
}

function createCaseConcurrencyRunState(): CaseConcurrencyRunState {
  return {
    active: 0,
    peak: 0,
    releases: [],
    started: [],
  }
}

function setCaseConcurrencyRunState(state: CaseConcurrencyRunState): void {
  ;(globalThis as typeof globalThis & {
    [caseConcurrencyRunStateKey]?: CaseConcurrencyRunState
  })[caseConcurrencyRunStateKey] = state
}

function clearCaseConcurrencyRunState(): void {
  delete (globalThis as typeof globalThis & {
    [caseConcurrencyRunStateKey]?: CaseConcurrencyRunState
  })[caseConcurrencyRunStateKey]
}

function clearTelemetryRunEndState(): void {
  delete (globalThis as typeof globalThis & {
    [telemetryRunEndStateKey]?: Array<{
      sawEvents: boolean
      sawSummary: boolean
    }>
  })[telemetryRunEndStateKey]
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value)
}

async function waitForExpectation(assertion: () => void, attempts = 30): Promise<void> {
  let lastError: unknown

  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion()
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  throw lastError
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  }
  catch {
    return false
  }
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
    input: {
      source: 'live-case',
    },
  }, { concurrency: 4 })
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

async function createBlockingExecutorProject(options: {
  concurrencySource?: string
  projects: BlockingProjectFixtureOptions[]
  topLevelConcurrencySource?: string
}): Promise<string> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-blocking-run-'))
  temporaryDirectories.push(temporaryDirectory)

  const cliConfigImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
  const evalConfigImportPath = join(packageDirectory, 'src', 'config', 'index.ts').replaceAll('\\', '/')

  await Promise.all(options.projects.map(async (project) => {
    const projectDirectory = join(temporaryDirectory, project.name, 'evals')
    await mkdir(projectDirectory, { recursive: true })

    await Promise.all(project.evalNames.map(async (evalName) => {
      await writeFile(
        join(projectDirectory, `${evalName}.eval.ts`),
        `
import { defineEval, defineTask } from '${evalConfigImportPath}'

export default defineEval({
  description: '${project.name} ${evalName}',
  name: '${evalName}',
  task: defineTask({
    id: '${evalName}',
    run() {
      return {
        scores: [
          {
            kind: 'exact',
            score: 1,
          },
        ],
      }
    },
  }),
})
`,
        'utf-8',
      )
    }))
  }))

  const projectEntries = options.projects.map(project => `
    {
      name: '${project.name}',
      root: './${project.name}',
      include: ['evals/*.eval.ts'],
      ${project.concurrencySource == null ? '' : `concurrency: ${project.concurrencySource},`}
      executor: async (task) => {
        const state = globalThis.${blockingRunStateKey}

        if (state == null) {
          throw new Error('Missing blocking run state.')
        }

        state.active += 1
        state.peak = Math.max(state.peak, state.active)
        state.started.push('${project.name}:' + task.entry.name)
        state.projectActive['${project.name}'] = (state.projectActive['${project.name}'] ?? 0) + 1
        state.projectPeak['${project.name}'] = Math.max(
          state.projectPeak['${project.name}'] ?? 0,
          state.projectActive['${project.name}'],
        )

        await new Promise<void>((resolve) => {
          state.releases.push(() => {
            state.active -= 1
            state.projectActive['${project.name}'] -= 1
            resolve()
          })
        })

        return {
          entryId: task.entry.id,
          id: task.id,
          inferenceExecutorId: task.inferenceExecutor.id,
          matrix: task.matrix,
          scores: [
            {
              kind: 'exact',
              score: 1,
            },
          ],
        }
      },
    }
  `).join(',\n')

  await writeFile(
    join(temporaryDirectory, 'vieval.config.ts'),
    `
import { defineConfig } from '${cliConfigImportPath}'

export default defineConfig({
  ${options.topLevelConcurrencySource == null ? '' : `concurrency: ${options.topLevelConcurrencySource},`}
  projects: [
${projectEntries}
  ],
})
`,
    'utf-8',
  )

  return temporaryDirectory
}

describe('runVievalCli', () => {
  afterEach(async () => {
    clearBlockingRunState()
    clearCaseConcurrencyRunState()
    clearTelemetryRunEndState()
    openTelemetryEventCalls.length = 0
    openTelemetrySpanCalls.length = 0
    activeOpenTelemetrySpan = undefined
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

  it('injects cache runtime into task execution and persists cache artifacts', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await createDslProject({
      evalFiles: {
        'cache-runtime.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('cache-runtime-task', () => {
  caseOf('cache-runtime-case', async (context) => {
    const artifact = context.cache.namespace('locomo').file({
      ext: 'json',
      key: ['fixtures', 'sample'],
    })

    await artifact.writeJson({ ok: true })
    const loaded = await artifact.readJson<{ ok: boolean }>()

    if (loaded.ok !== true) {
      throw new Error('cache-runtime-read-failed')
    }
  })
})
`,
      },
      executorSource: `async (task, context) => {
        if (task.entry.task == null) {
          throw new Error(\`Missing eval task definition for entry "\${task.entry.id}".\`)
        }

        const output = await task.entry.task.run({
          cache: context.cache,
          model: context.model,
          reporterHooks: context.reporterHooks,
          task,
        })

        return {
          entryId: task.entry.id,
          id: task.id,
          inferenceExecutorId: task.inferenceExecutor.id,
          matrix: task.matrix,
          scores: [...output.scores],
        }
      }`,
      projectName: 'cache-runtime-project',
    })

    const output = await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      workspace: 'workspace-cache',
    })

    const cacheArtifactPath = join(
      projectDirectory,
      '.vieval',
      'cache',
      'workspace-cache',
      'cache-runtime-project',
      'locomo',
      'fixtures',
      'sample.json',
    )
    const cacheArtifact = await readFile(cacheArtifactPath, 'utf-8')

    expect(output.projects[0]?.executed).toBe(true)
    expect(cacheArtifact).toContain('"ok": true')
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
    const summary = JSON.parse(summaryText) as CliRunOutput

    expect(summaryText).toContain('"workspaceId": "packages-vieval"')
    expect(summaryText).toContain('"experimentId": "baseline"')
    expect(summaryText).toContain('"attemptId": "attempt-1"')
    expect(summary.reportDirectory).toBe(output.reportDirectory)
    expect(eventsText.length).toBeGreaterThan(0)
    expect(await pathExists(join(output.reportDirectory!, 'cases.jsonl'))).toBe(true)
    expect(await pathExists(join(output.reportDirectory!, 'metrics-summary.json'))).toBe(true)
    expect(await pathExists(join(output.reportDirectory!, 'otlp', 'traces.json'))).toBe(true)
    expect(await pathExists(join(output.reportDirectory!, 'otlp', 'logs.json'))).toBe(true)
    expect(await pathExists(join(output.reportDirectory!, 'otlp', 'metrics.json'))).toBe(true)
    expect(await pathExists(join(output.reportDirectory!, 'benchmark'))).toBe(true)
  })

  /**
   * @example
   * it('writes semantic case, metrics, and OTLP artifact content') verifies report files are inspectable, not only present.
   */
  it('writes semantic case, metrics, and OTLP artifact content', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const reportOut = await mkdtemp(join(tmpdir(), 'vieval-report-semantic-'))
    temporaryDirectories.push(reportOut)

    const projectDirectory = await createDslProject({
      evalFiles: {
        'semantic-artifact.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('semantic-artifact-task', () => {
  caseOf('semantic-artifact-case', (context) => {
    context.metric('benchmark.id', 'locomo')
    context.metric('benchmark.case.id', 'case-semantic')
    context.metric('benchmark.locomo.category', 2)
    context.score(0.75)
    return {
      answer: '7 May 2023',
    }
  }, {
    input: {
      question: 'When did Alice visit?',
      sampleId: 'sample-1',
    },
  })
})
`,
      },
      projectName: 'semantic-artifact-project',
    })

    const output = await runVievalCli({
      attempt: 'attempt-semantic',
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      experiment: 'semantic-experiment',
      reportOut,
      workspace: 'semantic-workspace',
    })

    const casesText = await readFile(join(output.reportDirectory!, 'cases.jsonl'), 'utf-8')
    const metricsText = await readFile(join(output.reportDirectory!, 'metrics-summary.json'), 'utf-8')
    const tracesText = await readFile(join(output.reportDirectory!, 'otlp', 'traces.json'), 'utf-8')
    const caseRecord = JSON.parse(casesText.trim()) as {
      input?: { question?: string, sampleId?: string }
      metrics?: Record<string, unknown>
      output?: { answer?: string }
      scores?: Record<string, number>
    }
    const metricsSummary = JSON.parse(metricsText) as {
      overall?: Record<string, { average?: number }>
    }
    const traces = JSON.parse(tracesText) as {
      resourceSpans?: Array<{
        scopeSpans?: Array<{
          spans?: Array<{
            attributes?: Array<{ key: string }>
            name?: string
          }>
        }>
      }>
    }
    const spans = traces.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []

    expect(caseRecord.input?.question).toBe('When did Alice visit?')
    expect(caseRecord.output?.answer).toBe('7 May 2023')
    expect(caseRecord.metrics?.['benchmark.id']).toBe('locomo')
    expect(caseRecord.metrics?.['benchmark.case.id']).toBe('case-semantic')
    expect(caseRecord.scores?.exact).toBe(0.75)
    expect(metricsSummary.overall?.exact.average).toBe(0.75)
    expect(spans.some(span => span.name === 'vieval.case' && span.attributes?.some(attribute => attribute.key === 'benchmark.locomo.category'))).toBe(true)
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
  })
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

  /**
   * @example
   * it('uses OpenTelemetry runtime and waits for report artifacts before onRunEnd') verifies SDK shutdown hooks run after local files exist.
   */
  it('uses OpenTelemetry runtime and waits for report artifacts before onRunEnd', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const reportOut = await mkdtemp(join(tmpdir(), 'vieval-report-otel-'))
    const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-otel-run-'))
    temporaryDirectories.push(reportOut, projectDirectory)

    await mkdir(join(projectDirectory, 'evals'), { recursive: true })
    await writeFile(
      join(projectDirectory, 'evals', 'otel-task.eval.ts'),
      `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('otel-task', () => {
  caseOf('otel-case', (context) => {
    if (context.telemetry == null) {
      throw new Error('Missing telemetry runtime in case context.')
    }

    context.telemetry?.addEvent('case-context-observed', {
      'vieval.case.fixture': 'otel-case',
    })
  })
})
`,
      'utf-8',
    )
    await writeFile(
      join(projectDirectory, 'vieval.config.ts'),
      `
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig } from '${vievalImportPath}'

const reportOut = ${JSON.stringify(reportOut.replaceAll('\\', '/'))}
const runEndStateKey = ${JSON.stringify(telemetryRunEndStateKey)}

function hasReportFile(directory, fileName) {
  if (!existsSync(directory)) {
    return false
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isFile() && entry.name === fileName) {
      return true
    }
    if (entry.isDirectory() && hasReportFile(entryPath, fileName)) {
      return true
    }
  }

  return false
}

export default defineConfig({
  reporting: {
    openTelemetry: {
      enabled: true,
      async onRunEnd() {
        globalThis[runEndStateKey] ??= []
        const state = {
          sawEvents: hasReportFile(reportOut, 'events.jsonl'),
          sawSummary: hasReportFile(reportOut, 'run-summary.json'),
        }
        globalThis[runEndStateKey].push(state)

        if (!state.sawEvents || !state.sawSummary) {
          throw new Error('OpenTelemetry onRunEnd ran before local report artifacts were written.')
        }
      },
    },
  },
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
      name: 'otel-project',
      root: '.',
    },
  ],
})
`,
      'utf-8',
    )

    const output = await runVievalCli({
      attempt: 'attempt-otel',
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      experiment: 'otel-experiment',
      reportOut,
      workspace: 'otel-workspace',
    })
    const runEndStates = (globalThis as typeof globalThis & {
      [telemetryRunEndStateKey]?: Array<{
        sawEvents: boolean
        sawSummary: boolean
      }>
    })[telemetryRunEndStateKey]
    const metricsText = await readFile(join(output.reportDirectory!, 'otlp', 'metrics.json'), 'utf-8')
    const metricsArtifact = JSON.parse(metricsText) as {
      resourceMetrics?: Array<{
        scopeMetrics?: Array<{
          metrics?: Array<{
            gauge?: {
              dataPoints?: unknown[]
            }
            name?: string
          }>
        }>
      }>
    }
    const exactMetric = metricsArtifact.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.find(metric => metric.name === 'vieval.score.exact')

    expect(output.reportDirectory).toBeDefined()
    expect(output.projects[0]?.caseSummary?.passed).toBe(1)
    expect(exactMetric?.gauge?.dataPoints?.length).toBeGreaterThan(0)
    expect(openTelemetrySpanCalls).toEqual(expect.arrayContaining([
      {
        attributes: expect.objectContaining({
          'vieval.run.id': output.runId,
          'vieval.workspace.id': 'otel-workspace',
        }),
        name: 'vieval.run',
      },
      {
        attributes: expect.objectContaining({
          'vieval.project.name': 'otel-project',
          'vieval.run.id': output.runId,
        }),
        name: 'vieval.project',
      },
      {
        attributes: expect.objectContaining({
          'vieval.project.name': 'otel-project',
          'vieval.task.name': 'otel-task',
        }),
        name: 'vieval.task',
      },
      {
        attributes: expect.objectContaining({
          'vieval.case.name': 'otel-case',
          'vieval.task.name': 'otel-task',
        }),
        name: 'vieval.case',
      },
    ]))
    expect(openTelemetryEventCalls).toEqual(expect.arrayContaining([
      {
        attributes: {
          'vieval.case.fixture': 'otel-case',
        },
        name: 'case-context-observed',
      },
    ]))
    expect(runEndStates).toEqual([
      {
        sawEvents: true,
        sawSummary: true,
      },
    ])
  })

  /**
   * @example
   * it('passes telemetry runtime into project executor context') verifies custom executors share the CLI telemetry path.
   */
  it('passes telemetry runtime into project executor context', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-executor-telemetry-'))
    temporaryDirectories.push(projectDirectory)

    await mkdir(join(projectDirectory, 'evals'), { recursive: true })
    await writeFile(
      join(projectDirectory, 'evals', 'executor-task.eval.ts'),
      `
import { defineEval, defineTask } from '${join(packageDirectory, 'src', 'config', 'index.ts').replaceAll('\\', '/')}'

export default defineEval({
  name: 'executor-task',
  task: defineTask({
    id: 'executor-task',
    run() {
      return {
        scores: [{ kind: 'exact', score: 1 }],
      }
    },
  }),
})
`,
      'utf-8',
    )
    await writeFile(
      join(projectDirectory, 'vieval.config.ts'),
      `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  reporting: {
    openTelemetry: {
      enabled: true,
    },
  },
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'executor-telemetry-project',
      root: '.',
      executor: async (task, context) => {
        if (context.telemetry == null) {
          throw new Error('Missing telemetry runtime in executor context.')
        }

        context.telemetry?.addEvent('executor-context-observed', {
          'vieval.task.id': task.id,
        })

        return {
          entryId: task.entry.id,
          id: task.id,
          inferenceExecutorId: task.inferenceExecutor.id,
          matrix: task.matrix,
          scores: [{ kind: 'exact', score: 1 }],
        }
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

    expect(output.projects[0]?.errorMessage).toBeNull()
    expect(output.projects[0]?.result?.overall.runCount).toBe(1)
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

  /**
   * @example
   * it('formats final project hybrid score for terminal readability') verifies score precision stays concise.
   */
  it('formats final project hybrid score for terminal readability', () => {
    const summary = stripAnsi(formatVievalCliRunOutput({
      configFilePath: '/tmp/vieval.config.ts',
      projects: [
        {
          caseSummary: {
            failed: 0,
            passed: 1986,
            skipped: 0,
            timeout: 0,
            total: 1986,
          },
          discoveredEvalFileCount: 1,
          durationMs: 9_986_250,
          entryCount: 1,
          errorMessage: null,
          executed: true,
          matrixSummary: null,
          name: 'locomo-lobehub',
          result: {
            overall: {
              exactAverage: 0.3851948392189298,
              hybridAverage: 0.3851948392189298,
              judgeAverage: null,
              runCount: 1,
            },
            inferenceExecutors: [],
            runs: [],
          },
          taskCount: 1,
        },
      ],
    }))

    expect(summary).toContain('hybrid 0.385')
    expect(summary).not.toContain('0.3851948392189298')
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

  it('runs tasks from multiple projects concurrently while honoring workspace and project caps', async () => {
    const state = createBlockingRunState()
    setBlockingRunState(state)

    const projectDirectory = await createBlockingExecutorProject({
      projects: [
        {
          concurrencySource: '{ project: 1, task: 2 }',
          evalNames: ['alpha-1', 'alpha-2'],
          name: 'alpha',
        },
        {
          concurrencySource: '{ project: 1, task: 2 }',
          evalNames: ['beta-1', 'beta-2'],
          name: 'beta',
        },
      ],
      topLevelConcurrencySource: '{ workspace: 2 }',
    })

    const runPromise = runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
    })

    await waitForExpectation(() => {
      expect(state.started).toHaveLength(2)
      expect(state.started.some(entry => entry.startsWith('alpha:'))).toBe(true)
      expect(state.started.some(entry => entry.startsWith('beta:'))).toBe(true)
      expect(state.projectPeak.alpha).toBe(1)
      expect(state.projectPeak.beta).toBe(1)
      expect(state.peak).toBe(2)
    })

    await Promise.resolve()
    expect(state.started).toHaveLength(2)

    state.releases.splice(0).forEach(release => release())

    await waitForExpectation(() => {
      expect(state.started).toHaveLength(4)
    })

    state.releases.splice(0).forEach(release => release())

    const output = await runPromise

    expect(output.projects).toHaveLength(2)
    expect(output.projects.every(project => project.executed)).toBe(true)
  })

  it('caps task execution concurrency with CLI taskConcurrency over higher project defaults', async () => {
    const state = createBlockingRunState()
    setBlockingRunState(state)

    const projectDirectory = await createBlockingExecutorProject({
      projects: [
        {
          concurrencySource: '{ task: 3 }',
          evalNames: ['task-1', 'task-2', 'task-3'],
          name: 'alpha',
        },
      ],
    })

    const runPromise = runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      taskConcurrency: 2,
    })

    await waitForExpectation(() => {
      expect(state.started).toHaveLength(2)
      expect(state.peak).toBe(2)
    })

    await Promise.resolve()
    expect(state.started).toHaveLength(2)

    state.releases.splice(0).forEach(release => release())

    await waitForExpectation(() => {
      expect(state.started).toHaveLength(3)
    })

    state.releases.splice(0).forEach(release => release())

    const output = await runPromise

    expect(output.projects[0]?.executed).toBe(true)
  })

  it('does not raise task execution concurrency above the configured project default', async () => {
    const state = createBlockingRunState()
    setBlockingRunState(state)

    const projectDirectory = await createBlockingExecutorProject({
      projects: [
        {
          concurrencySource: '{ task: 1 }',
          evalNames: ['task-1', 'task-2'],
          name: 'alpha',
        },
      ],
    })

    const runPromise = runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      taskConcurrency: 3,
    })

    await waitForExpectation(() => {
      expect(state.started).toHaveLength(1)
      expect(state.peak).toBe(1)
    })

    await Promise.resolve()
    expect(state.started).toHaveLength(1)

    state.releases.splice(0).forEach(release => release())

    await waitForExpectation(() => {
      expect(state.started).toHaveLength(2)
    })

    state.releases.splice(0).forEach(release => release())

    const output = await runPromise

    expect(output.projects[0]?.executed).toBe(true)
  })

  it('runs the concurrency-cases-from-inputs fixture as an executable example', async () => {
    const output = await runVievalCli({
      configFilePath: join(concurrencyCasesFromInputsProjectDirectory, 'vieval.config.ts'),
      cwd: concurrencyCasesFromInputsProjectDirectory,
    })

    expect(output.projects[0]?.executed).toBe(true)
    expect(output.projects[0]?.taskCount).toBe(1)
  }, 60_000)

  it('runs the concurrency-task fixture as an executable example', async () => {
    const output = await runVievalCli({
      configFilePath: join(concurrencyTaskProjectDirectory, 'vieval.config.ts'),
      cwd: concurrencyTaskProjectDirectory,
    })

    expect(output.projects[0]?.executed).toBe(true)
    expect(output.projects[0]?.taskCount).toBe(1)
  })

  it('runs the concurrency-cli-overrides fixture with CLI caps as an executable example', async () => {
    const output = await runVievalCli({
      configFilePath: join(concurrencyCliOverridesProjectDirectory, 'vieval.config.ts'),
      cwd: concurrencyCliOverridesProjectDirectory,
      projectConcurrency: 1,
      taskConcurrency: 1,
      workspaceConcurrency: 1,
    })

    expect(output.projects).toHaveLength(1)
    expect(output.projects[0]?.executed).toBe(true)
  })

  it('applies CLI caseConcurrency to DSL casesFromInputs task execution', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const state = createCaseConcurrencyRunState()
    setCaseConcurrencyRunState(state)

    const projectDirectory = await createDslProject({
      evalFiles: {
        'cli-case-concurrency.eval.ts': `
import { describeTask } from '${vievalImportPath}'

describeTask('cli-case-concurrency', (task) => {
  task.casesFromInputs('sample', [1, 2, 3, 4], async (context) => {
    const state = globalThis.${caseConcurrencyRunStateKey}

    if (state == null) {
      throw new Error('Missing case concurrency run state.')
    }

    const input = context.matrix.inputs
    state.active += 1
    state.peak = Math.max(state.peak, state.active)
    state.started.push(input)

    await new Promise<void>((resolve) => {
      state.releases.push(() => {
        state.active -= 1
        resolve()
      })
    })
  })
})
`,
      },
      projectName: 'cli-case-concurrency',
    })

    const runPromise = runVievalCli({
      caseConcurrency: 2,
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
    })

    await waitForExpectation(() => {
      expect(state.started).toEqual([1, 2])
    })
    expect(state.peak).toBe(2)

    state.releases.shift()?.()

    await waitForExpectation(() => {
      expect(state.started).toEqual([1, 2, 3])
    })
    expect(state.peak).toBe(2)

    state.releases.shift()?.()

    await waitForExpectation(() => {
      expect(state.started).toEqual([1, 2, 3, 4])
    })
    expect(state.peak).toBe(2)

    while (state.releases.length > 0) {
      state.releases.shift()?.()
    }

    const output = await runPromise
    expect(output.projects[0]?.executed).toBe(true)
  })

  it('keeps experiment as run metadata and not as a scheduling scope', async () => {
    const output = await runVievalCli({
      configFilePath: join(taskProjectDirectory, 'vieval.config.ts'),
      cwd: taskProjectDirectory,
      experiment: 'baseline-exp',
    })

    expect(output.experimentId).toBe('baseline-exp')
    expect(output.projects[0]?.executed).toBe(true)
  })

  it('runs the concurrency-experiment-metadata fixture and keeps experiment as metadata', async () => {
    const output = await runVievalCli({
      configFilePath: join(concurrencyExperimentMetadataProjectDirectory, 'vieval.config.ts'),
      cwd: concurrencyExperimentMetadataProjectDirectory,
      experiment: 'fixture-exp',
    })

    expect(output.experimentId).toBe('fixture-exp')
    expect(output.projects[0]?.executed).toBe(true)
  })

  it('runs the execution-policy-timeout fixture and reports timeout cases distinctly', async () => {
    const output = await runVievalCli({
      configFilePath: join(executionPolicyTimeoutProjectDirectory, 'vieval.config.ts'),
      cwd: executionPolicyTimeoutProjectDirectory,
    })

    expect(output.projects[0]?.executed).toBe(true)
    expect(output.projects[0]?.caseSummary).toEqual({
      failed: 0,
      passed: 1,
      skipped: 0,
      timeout: 1,
      total: 2,
    })
    expect(output.projects[0]?.caseFailures?.[0]?.errorMessage).toContain('timed out')
  })

  it('runs the execution-policy-auto-retry fixture and recovers after in-attempt retries', async () => {
    const output = await runVievalCli({
      configFilePath: join(executionPolicyAutoRetryProjectDirectory, 'vieval.config.ts'),
      cwd: executionPolicyAutoRetryProjectDirectory,
    })

    expect(output.projects[0]?.executed).toBe(true)
    expect(output.projects[0]?.caseSummary).toEqual({
      failed: 0,
      passed: 1,
      skipped: 0,
      timeout: 0,
      total: 1,
    })
    expect(output.projects[0]?.caseFailures).toEqual([])
  })

  it('runs the execution-policy-auto-attempt fixture and waits for the first attempt to settle before retrying the task', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-auto-attempt-log-'))
    temporaryDirectories.push(temporaryDirectory)
    const logFilePath = join(temporaryDirectory, 'attempt-log.json')

    process.env.VIEVAL_TEST_LOG_PATH = logFilePath

    try {
      const output = await runVievalCli({
        configFilePath: join(executionPolicyAutoAttemptProjectDirectory, 'vieval.config.ts'),
        cwd: executionPolicyAutoAttemptProjectDirectory,
      })

      expect(output.projects[0]?.executed).toBe(true)
      expect(output.projects[0]?.caseSummary).toEqual({
        failed: 0,
        passed: 2,
        skipped: 0,
        timeout: 0,
        total: 2,
      })

      const logEntries = (await readFile(logFilePath, 'utf-8'))
        .split('\n')
        .filter(Boolean)
      const attemptZeroEndIndex = Math.max(
        logEntries.indexOf('end:case-a:0'),
        logEntries.indexOf('end:case-b:0:failed'),
      )
      const attemptOneStartIndex = Math.min(
        logEntries.indexOf('start:case-a:1'),
        logEntries.indexOf('start:case-b:1'),
      )

      expect(attemptZeroEndIndex).toBeGreaterThan(-1)
      expect(attemptOneStartIndex).toBeGreaterThan(-1)
      expect(attemptOneStartIndex).toBeGreaterThan(logEntries.indexOf('end:case-a:0'))
      expect(attemptOneStartIndex).toBeGreaterThan(logEntries.indexOf('end:case-b:0:failed'))
    }
    finally {
      delete process.env.VIEVAL_TEST_LOG_PATH
    }
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

  it('includes failed case error messages in JSON output and terminal summary', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await createDslProject({
      evalFiles: {
        'failed-case.eval.ts': `
import { caseOf, describeTask, expect } from '${vievalImportPath}'

describeTask('failed-case-task', () => {
  caseOf('failed-case', () => {
    expect('left').toBe('right')
  })
})
`,
      },
      projectName: 'failed-case-project',
    })

    const output = await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
    })

    expect(output.projects[0]?.caseFailures?.length).toBe(1)
    expect(output.projects[0]?.caseFailures?.[0]?.caseName).toBe('failed-case')
    expect(output.projects[0]?.caseFailures?.[0]?.errorMessage).toContain('expected')

    const summary = formatVievalCliRunOutput(output)
    expect(summary).toContain('Failed cases:')
    expect(summary).toContain('failed-case')
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
    expect(terminalOutput).toContain('planned')
    expect(terminalOutput).toContain('running')
    expect(terminalOutput).toContain('elapsed')
    expect(terminalOutput).toContain('estimated')
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
    input: {
      source: 'custom-case',
    },
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
    expect(terminalOutput).toContain('Cases')
    expect(terminalOutput).toContain('1 passed')
    expect(terminalOutput).toContain('estimated')
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
    input: {
      source: 'first-case',
    },
  })
})
`,
        'second.eval.ts': `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('second-task', () => {
  caseOf('second-case', () => {}, {
    input: {
      source: 'second-case',
    },
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
    input: {
      source: 'observer-case',
    },
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
      vi.resetModules()
    }
  })

  it('cleans up reporter and environment when OpenTelemetry run-end hook fails', async () => {
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-otel-run-end-failure-'))
    temporaryDirectories.push(projectDirectory)

    await writeFile(
      join(projectDirectory, 'vieval.config.ts'),
      `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  env: {
    VIEVAL_OTEL_RUN_END_TEST: 'inside-config',
  },
  reporting: {
    openTelemetry: {
      enabled: true,
      async onRunEnd() {
        throw new Error('otel shutdown boom')
      },
    },
  },
  projects: [],
})
`,
      'utf-8',
    )

    const reporterEvents: Array<{ type: string }> = []
    const previousEnv = process.env.VIEVAL_OTEL_RUN_END_TEST
    process.env.VIEVAL_OTEL_RUN_END_TEST = 'outside-config'

    vi.resetModules()
    vi.doMock('./reporters', () => ({
      createCliReporter: () => ({
        dispose() {
          reporterEvents.push({ type: 'dispose' })
        },
        onCaseEnd() {},
        onCaseStart() {},
        onRunEnd() {},
        onRunStart() {},
        onTaskEnd() {},
        onTaskQueued() {},
        onTaskStart() {},
      }),
    }))

    try {
      const { runVievalCli: isolatedRunVievalCli } = await import('./run')

      await expect(isolatedRunVievalCli({
        configFilePath: join(projectDirectory, 'vieval.config.ts'),
        cwd: projectDirectory,
      })).rejects.toThrow('otel shutdown boom')

      expect(reporterEvents).toEqual([{ type: 'dispose' }])
      expect(process.env.VIEVAL_OTEL_RUN_END_TEST).toBe('outside-config')
    }
    finally {
      vi.doUnmock('./reporters')
      vi.resetModules()
      if (previousEnv == null) {
        delete process.env.VIEVAL_OTEL_RUN_END_TEST
      }
      else {
        process.env.VIEVAL_OTEL_RUN_END_TEST = previousEnv
      }
    }
  })

  it('reports skipped no-executor project tasks in run totals', async () => {
    const configImportPath = join(packageDirectory, 'src', 'config', 'index.ts').replaceAll('\\', '/')
    const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
    const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-run-total-semantics-'))
    temporaryDirectories.push(projectDirectory)

    await mkdir(join(projectDirectory, 'exec'), { recursive: true })
    await mkdir(join(projectDirectory, 'skipped'), { recursive: true })
    await writeFile(
      join(projectDirectory, 'exec', 'exec.eval.ts'),
      `
import { defineEval, defineTask } from '${configImportPath}'

export default defineEval({
  name: 'exec-task',
  task: defineTask({
    id: 'exec-task',
    run() {
      return {
        scores: [{ kind: 'exact', score: 1 }],
      }
    },
  }),
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
    input: {
      source: 'skipped-case',
    },
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
    expect(formatVievalCliRunOutput(output)).toContain('Tasks     1 executed / 2 scheduled')
  })
})

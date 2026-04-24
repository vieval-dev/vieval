import type {
  CreateSchedulerRuntimeOptions,
  SchedulerConcurrencyConfig,
  SchedulerMiddleware,
  SchedulerRuntime,
  SchedulerScope,
  SchedulerScopeContext,
} from './types'

import { createSchedulerQueue } from './queue'

const schedulerScopeOrder: SchedulerScope[] = [
  'workspace',
  'project',
  'task',
  'attempt',
  'case',
]

/**
 * Creates the core scheduler runtime used to serialize work by scope.
 *
 * Call stack:
 *
 * {@link createSchedulerRuntime}
 *   -> `createRuntimeQueues`
 *     -> `runtime.runCase(context, execute)`
 *       -> `runWithQueues`
 *         -> `runAcquireMiddleware`
 *           -> `execute`
 *         -> `runReleaseMiddleware`
 *
 * Use when:
 * - runner code needs concurrency caps for queued case execution
 * - middleware should wrap work with acquire/release lifecycle hooks
 *
 * Expects:
 * - middleware is ordered from outermost to innermost concern
 * - concurrency caps are positive integers when provided
 *
 * Returns:
 * - a scheduler runtime with case execution support
 */
export function createSchedulerRuntime(
  options: CreateSchedulerRuntimeOptions = {},
): SchedulerRuntime {
  const middleware = options.middleware ?? []
  const queues = createRuntimeQueues(options.concurrency ?? {})

  return {
    runCase<T>(context: SchedulerScopeContext, execute: () => Promise<T>) {
      const activeScopes = getActiveScopes(context)

      return runWithQueues(activeScopes, context, queues, () => {
        if (middleware.length === 0) {
          return execute()
        }

        return runWithMiddlewareEnvelope(middleware, context, execute)
      })
    },
  }
}

/**
 * Resolves the scheduler scopes that apply to a context.
 *
 * Before:
 * - `{ scope: 'case', workspaceId: 'ws', experimentId: 'exp', caseId: 'case-1' }`
 *
 * After:
 * - `['workspace', 'project', 'task', 'attempt', 'case']` up to the requested scope
 */
export function getActiveScopes(context: SchedulerScopeContext): SchedulerScope[] {
  const targetScopeIndex = schedulerScopeOrder.indexOf(context.scope)

  if (targetScopeIndex < 0) {
    return []
  }

  return schedulerScopeOrder.slice(0, targetScopeIndex + 1)
}

function createRuntimeQueues(concurrency: SchedulerConcurrencyConfig) {
  const queues = new Map<SchedulerScope, SchedulerScopeQueueRegistry>()

  for (const scope of schedulerScopeOrder) {
    const scopeConcurrency = concurrency[scope]

    if (scopeConcurrency === undefined) {
      continue
    }

    validateSchedulerConcurrency(scope, scopeConcurrency)

    queues.set(scope, {
      concurrency: scopeConcurrency,
      instances: new Map<string, ReturnType<typeof createSchedulerQueue>>(),
    })
  }

  return queues
}

async function runWithQueues<T>(
  scopes: SchedulerScope[],
  context: SchedulerScopeContext,
  queues: Map<SchedulerScope, SchedulerScopeQueueRegistry>,
  execute: () => Promise<T>,
  index = 0,
): Promise<T> {
  const scope = scopes[index]

  if (scope === undefined) {
    return execute()
  }

  const queue = getScopeQueue(scope, context, queues)

  if (queue === undefined) {
    return runWithQueues(scopes, context, queues, execute, index + 1)
  }

  return queue.run(() => runWithQueues(scopes, context, queues, execute, index + 1))
}

interface SchedulerScopeQueueRegistry {
  concurrency: number
  instances: Map<string, ReturnType<typeof createSchedulerQueue>>
}

interface SchedulerEnvelopeResult<T> {
  releaseStack: SchedulerMiddleware[]
  outcome: SchedulerExecutionOutcome<T>
}

interface SchedulerExecutionFailure {
  error: unknown
  status: 'failed'
}

interface SchedulerExecutionSkipped {
  status: 'skipped'
}

interface SchedulerExecutionSuccess<T> {
  status: 'succeeded'
  value: T
}

type SchedulerExecutionOutcome<T>
  = | SchedulerExecutionFailure
    | SchedulerExecutionSkipped
    | SchedulerExecutionSuccess<T>

function getScopeQueue(
  scope: SchedulerScope,
  context: SchedulerScopeContext,
  queues: Map<SchedulerScope, SchedulerScopeQueueRegistry>,
) {
  const queueRegistry = queues.get(scope)

  if (queueRegistry === undefined) {
    return undefined
  }

  const scopeKey = getSchedulerScopeInstanceKey(scope, context)
  const existingQueue = queueRegistry.instances.get(scopeKey)

  if (existingQueue !== undefined) {
    return existingQueue
  }

  const queue = createSchedulerQueue(queueRegistry.concurrency)
  queueRegistry.instances.set(scopeKey, queue)
  return queue
}

function getSchedulerScopeInstanceKey(
  scope: SchedulerScope,
  context: SchedulerScopeContext,
): string {
  const workspaceKey = `workspace:${context.workspaceId}:experiment:${context.experimentId}`
  const projectKey = `${workspaceKey}:project:${context.projectName ?? '(missing-project)'}`
  const taskKey = `${projectKey}:task:${context.taskId ?? '(missing-task)'}`
  const attemptKey = `${taskKey}:attempt:${context.attemptIndex ?? '(missing-attempt)'}`

  switch (scope) {
    case 'workspace':
      return workspaceKey
    case 'project':
      return projectKey
    case 'task':
      return taskKey
    case 'attempt':
      return attemptKey
    case 'case':
      return attemptKey
  }
}

async function runWithMiddlewareEnvelope<T>(
  middleware: SchedulerMiddleware[],
  context: SchedulerScopeContext,
  execute: () => Promise<T>,
): Promise<T> {
  const result = await runAcquireMiddleware(middleware, context, execute, 0)

  try {
    switch (result.outcome.status) {
      case 'succeeded':
        return result.outcome.value
      case 'failed':
        throw result.outcome.error
      case 'skipped':
        throw createSchedulerShortCircuitError()
    }
  }
  finally {
    await runReleaseMiddleware(result.releaseStack, context, result.releaseStack.length - 1)
  }
}

async function runAcquireMiddleware<T>(
  middleware: SchedulerMiddleware[],
  context: SchedulerScopeContext,
  execute: () => Promise<T>,
  index: number,
): Promise<SchedulerEnvelopeResult<T>> {
  const currentMiddleware = middleware[index]

  if (currentMiddleware === undefined) {
    return createSchedulerExecutionResult([], execute)
  }

  let nextResult = createSchedulerShortCircuitResult<T>()
  let didCallNext = false

  const next = async () => {
    didCallNext = true
    nextResult = await runAcquireMiddleware(middleware, context, execute, index + 1)
  }

  try {
    if (currentMiddleware.onAcquire === undefined) {
      await next()
    }
    else {
      await currentMiddleware.onAcquire(context, next)
    }
  }
  catch (error) {
    if (!didCallNext) {
      return createSchedulerFailureResult([], error)
    }

    return createSchedulerFailureResult(
      [currentMiddleware, ...nextResult.releaseStack],
      error,
    )
  }

  return {
    releaseStack: [currentMiddleware, ...nextResult.releaseStack],
    outcome: nextResult.outcome,
  }
}

async function runReleaseMiddleware(
  releaseStack: SchedulerMiddleware[],
  context: SchedulerScopeContext,
  index: number,
): Promise<void> {
  const currentMiddleware = releaseStack[index]

  if (currentMiddleware === undefined) {
    return
  }

  if (currentMiddleware.onRelease === undefined) {
    await runReleaseMiddleware(releaseStack, context, index - 1)
    return
  }

  await currentMiddleware.onRelease(context, async () => {
    await runReleaseMiddleware(releaseStack, context, index - 1)
  })
}

async function createSchedulerExecutionResult<T>(
  releaseStack: SchedulerMiddleware[],
  execute: () => Promise<T>,
): Promise<SchedulerEnvelopeResult<T>> {
  try {
    return {
      releaseStack,
      outcome: {
        status: 'succeeded',
        value: await execute(),
      },
    }
  }
  catch (error) {
    return {
      releaseStack,
      outcome: {
        status: 'failed',
        error,
      },
    }
  }
}

function createSchedulerFailureResult<T>(
  releaseStack: SchedulerMiddleware[],
  error: unknown,
): SchedulerEnvelopeResult<T> {
  return {
    releaseStack,
    outcome: {
      status: 'failed',
      error,
    },
  }
}

function createSchedulerShortCircuitResult<T>(): SchedulerEnvelopeResult<T> {
  return {
    releaseStack: [],
    outcome: {
      status: 'skipped',
    },
  }
}

function validateSchedulerConcurrency(scope: SchedulerScope, concurrency: number): void {
  if (!Number.isFinite(concurrency) || !Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`Invalid scheduler concurrency for "${scope}": ${String(concurrency)}`)
  }
}

function createSchedulerShortCircuitError(): Error {
  return new Error('Scheduler middleware short-circuited execution.')
}

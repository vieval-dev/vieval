import type { SchedulerQueue } from './queue'
import type {
  CreateSchedulerOptions,
  Scheduler,
  SchedulerBoundContext,
  SchedulerConcurrencyConfig,
  SchedulerMiddleware,
  SchedulerRunContext,
  SchedulerScope,
  SchedulerScopeContext,
} from './types'

import { createSchedulerQueue } from './queue'

const schedulerScopes: SchedulerScope[] = ['project', 'task', 'case']

interface SchedulerEnvelopeResult<T> {
  outcome: SchedulerExecutionOutcome<T>
  releaseStack: SchedulerMiddleware[]
}

interface SchedulerExecutionFailure {
  error: unknown
  status: 'failed'
}

type SchedulerExecutionOutcome<T>
  = | SchedulerExecutionFailure
    | SchedulerExecutionSkipped
    | SchedulerExecutionSuccess<T>

interface SchedulerExecutionSkipped {
  status: 'skipped'
}

interface SchedulerExecutionSuccess<T> {
  status: 'succeeded'
  value: T
}

interface SchedulerNode extends Scheduler {
  admit: <T>(context: SchedulerScopeContext, execute: () => Promise<T>) => Promise<T>
  boundContext: SchedulerBoundContext
}

/**
 * Creates the root of a scheduler tree.
 *
 * Call stack:
 *
 * {@link createScheduler}
 *   -> {@link Scheduler.child} (project, task, case group)
 *     -> {@link Scheduler.run}
 *       -> own pool for `context.scope`
 *         -> parent {@link Scheduler.run} ... up to the root pool
 *           -> `runWithMiddlewareEnvelope` (root middleware, then each child's)
 *             -> `execute`
 *
 * Use when:
 * - a run, or a task running outside `vieval run`, needs one admission boundary for projects, tasks, and cases
 *
 * Expects:
 * - pool sizes are positive integers when provided
 * - middleware is ordered from outermost to innermost concern
 *
 * Returns:
 * - a scheduler whose pools bound every unit run through it or its children
 */
export function createScheduler(options: CreateSchedulerOptions = {}): Scheduler {
  return createSchedulerNode(options, undefined)
}

function createPools(concurrency: SchedulerConcurrencyConfig): Map<SchedulerScope, SchedulerQueue> {
  const pools = new Map<SchedulerScope, SchedulerQueue>()

  for (const scope of schedulerScopes) {
    const size = concurrency[scope]
    if (size === undefined) {
      continue
    }

    validateSchedulerConcurrency(scope, size)
    pools.set(scope, createSchedulerQueue(size))
  }

  return pools
}

async function createSchedulerExecutionResult<T>(
  releaseStack: SchedulerMiddleware[],
  execute: () => Promise<T>,
): Promise<SchedulerEnvelopeResult<T>> {
  try {
    return {
      outcome: {
        status: 'succeeded',
        value: await execute(),
      },
      releaseStack,
    }
  }
  catch (error) {
    return {
      outcome: {
        error,
        status: 'failed',
      },
      releaseStack,
    }
  }
}

function createSchedulerFailureResult<T>(
  releaseStack: SchedulerMiddleware[],
  error: unknown,
): SchedulerEnvelopeResult<T> {
  return {
    outcome: {
      error,
      status: 'failed',
    },
    releaseStack,
  }
}

function createSchedulerNode(options: CreateSchedulerOptions, parent: SchedulerNode | undefined): SchedulerNode {
  const pools = createPools(options.concurrency ?? {})
  const middleware = options.middleware ?? []
  // Each node keeps every id bound on its path, so its middleware sees the full context.
  const boundContext: SchedulerBoundContext = { ...parent?.boundContext, ...options.context }

  const node: SchedulerNode = {
    admit<T>(context: SchedulerScopeContext, execute: () => Promise<T>) {
      const wrapped = middleware.length === 0
        ? execute
        : async () => await runWithMiddlewareEnvelope(middleware, context, execute)
      // The parent admits after this node, so its pools are acquired narrow to broad and its middleware wraps ours.
      const admitted = parent == null ? wrapped : async () => await parent.admit(context, wrapped)
      const pool = pools.get(context.scope)

      return pool == null ? admitted() : pool.run(admitted)
    },
    boundContext,
    child(childOptions = {}) {
      return createSchedulerNode(childOptions, node)
    },
    run<T>(runContext: SchedulerRunContext, execute: () => Promise<T>) {
      const context: SchedulerScopeContext = { ...boundContext, ...runContext }
      return node.admit(context, execute)
    },
  }

  return node
}

function createSchedulerShortCircuitError(): Error {
  return new Error('Scheduler middleware short-circuited execution.')
}

function createSchedulerShortCircuitResult<T>(): SchedulerEnvelopeResult<T> {
  return {
    outcome: {
      status: 'skipped',
    },
    releaseStack: [],
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
    outcome: nextResult.outcome,
    releaseStack: [currentMiddleware, ...nextResult.releaseStack],
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

function validateSchedulerConcurrency(scope: SchedulerScope, concurrency: number): void {
  if (!Number.isFinite(concurrency) || !Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`Invalid scheduler concurrency for "${scope}": ${String(concurrency)}`)
  }
}

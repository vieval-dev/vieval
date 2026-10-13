import type { SchedulerMiddleware, SchedulerScopeContext } from './types'

import { describe, expect, it } from 'vitest'

import { createScheduler } from './runtime'

describe('createScheduler', () => {
  it('limits units of one scope to the pool size', async () => {
    const work = createControlledWork()
    const scheduler = createScheduler({ concurrency: { case: 2 } })

    const runs = ['a', 'b', 'c', 'd'].map(name => scheduler.run({ caseId: name, scope: 'case' }, work.start(name)))
    await flushMicrotasks()

    expect(work.started).toEqual(['a', 'b'])

    work.release('a')
    await flushMicrotasks()

    expect(work.started).toEqual(['a', 'b', 'c'])

    work.releaseAll()
    await Promise.all(runs)

    expect(work.started).toEqual(['a', 'b', 'c', 'd'])
    expect(work.peak).toBe(2)
  })

  it('shares a child pool only among work run through that child', async () => {
    const work = createControlledWork()
    const root = createScheduler()
    const alpha = root.child({ concurrency: { case: 1 } })
    const beta = root.child({ concurrency: { case: 1 } })

    const runs = [
      alpha.run({ scope: 'case' }, work.start('alpha-1')),
      alpha.run({ scope: 'case' }, work.start('alpha-2')),
      beta.run({ scope: 'case' }, work.start('beta-1')),
    ]
    await flushMicrotasks()

    expect(work.started).toEqual(['alpha-1', 'beta-1'])

    work.releaseAll()
    await Promise.all(runs)

    expect(work.started).toEqual(['alpha-1', 'beta-1', 'alpha-2'])
  })

  // The OSWorld shape: several tasks with their own case caps still share one run-wide case pool.
  it('bounds work of every child by the pool of the parent', async () => {
    const work = createControlledWork()
    const run = createScheduler({ concurrency: { case: 3 } })
    const tasks = ['chrome', 'gimp', 'vlc'].map(name => ({ name, scheduler: run.child({ concurrency: { case: 2 } }) }))

    const runs = tasks.flatMap(task => [1, 2].map(index =>
      task.scheduler.run({ scope: 'case' }, work.start(`${task.name}-${index}`)),
    ))
    await flushMicrotasks()

    expect(work.started).toEqual(['chrome-1', 'chrome-2', 'gimp-1'])

    work.releaseAll()
    await Promise.all(runs)

    expect(work.peak).toBe(3)
  })

  it('acquires the narrow pool before the broad pool so blocked work holds no broad slot', async () => {
    const work = createControlledWork()
    const run = createScheduler({ concurrency: { case: 2 } })
    const narrowGroup = run.child({ concurrency: { case: 1 } })
    const otherGroup = run.child()

    const runs = [
      narrowGroup.run({ scope: 'case' }, work.start('narrow-1')),
      // Waits for the narrow group, so it must not take the second run-wide slot.
      narrowGroup.run({ scope: 'case' }, work.start('narrow-2')),
      otherGroup.run({ scope: 'case' }, work.start('other-1')),
    ]
    await flushMicrotasks()

    expect(work.started).toEqual(['narrow-1', 'other-1'])

    work.releaseAll()
    await Promise.all(runs)
  })

  it('counts each scope in its own pool', async () => {
    const work = createControlledWork()
    const scheduler = createScheduler({ concurrency: { case: 1, project: 1, task: 1 } })

    const run = scheduler.run({ scope: 'project' }, async () =>
      await scheduler.run({ scope: 'task' }, async () =>
        await scheduler.run({ scope: 'case' }, work.start('case'))))
    await flushMicrotasks()

    expect(work.started).toEqual(['case'])

    work.releaseAll()
    await run
  })

  it('merges ids bound on the path into the context seen by middleware', async () => {
    const contexts: SchedulerScopeContext[] = []
    const run = createScheduler({
      context: { experimentId: 'baseline', workspaceId: 'ws' },
      middleware: [recordingMiddleware(contexts)],
    })
    const task = run.child({ context: { projectName: 'chat' } }).child({ context: { taskId: 'task-a' } })

    await task.run({ attemptIndex: 1, caseId: 'case-1', scope: 'case' }, async () => {})

    expect(contexts).toEqual([{
      attemptIndex: 1,
      caseId: 'case-1',
      experimentId: 'baseline',
      projectName: 'chat',
      scope: 'case',
      taskId: 'task-a',
      workspaceId: 'ws',
    }])
  })

  it('runs parent middleware around child middleware once every slot is held', async () => {
    const events: string[] = []
    const run = createScheduler({
      concurrency: { case: 1 },
      middleware: [namedMiddleware('run', events)],
    })
    const project = run.child({ concurrency: { case: 1 }, middleware: [namedMiddleware('project', events)] })

    await project.run({ scope: 'case' }, async () => {
      events.push('work')
    })

    expect(events).toEqual([
      'run:acquire:case',
      'project:acquire:case',
      'work',
      'project:release:case',
      'run:release:case',
    ])
  })

  it('runs acquire middleware in listed order and release middleware in reverse order', async () => {
    const events: string[] = []
    const scheduler = createScheduler({
      middleware: [
        namedMiddleware('root', events),
        namedMiddleware('middle', events),
        namedMiddleware('leaf', events),
      ],
    })

    await scheduler.run({ scope: 'case' }, async () => {
      events.push('work')
    })

    expect(events).toEqual([
      'root:acquire:case',
      'middle:acquire:case',
      'leaf:acquire:case',
      'work',
      'leaf:release:case',
      'middle:release:case',
      'root:release:case',
    ])
  })

  it('throws a scheduler-owned error when acquire middleware short-circuits work', async () => {
    const events: string[] = []
    const scheduler = createScheduler({
      middleware: [
        {
          async onAcquire(context) {
            events.push(`root:acquire:${context.scope}`)
          },
          async onRelease(context, next) {
            events.push(`root:release:${context.scope}`)
            await next()
          },
        },
        namedMiddleware('leaf', events),
      ],
    })

    await expect(scheduler.run({ scope: 'case' }, async () => {
      events.push('work')
      return 'unreachable'
    })).rejects.toThrowError('Scheduler middleware short-circuited execution.')

    expect(events).toEqual([
      'root:acquire:case',
      'root:release:case',
    ])
  })

  it('only unwinds release middleware for the acquire chain that was entered', async () => {
    const events: string[] = []
    const scheduler = createScheduler({
      middleware: [
        namedMiddleware('root', events),
        {
          async onAcquire(context) {
            events.push(`middle:acquire:${context.scope}`)
          },
          async onRelease(context, next) {
            events.push(`middle:release:${context.scope}`)
            await next()
          },
        },
        namedMiddleware('leaf', events),
      ],
    })

    await expect(scheduler.run({ scope: 'case' }, async () => {
      events.push('work')
    })).rejects.toThrowError('Scheduler middleware short-circuited execution.')

    expect(events).toEqual([
      'root:acquire:case',
      'middle:acquire:case',
      'middle:release:case',
      'root:release:case',
    ])
  })

  it('runs release middleware when work throws and preserves the original error', async () => {
    const events: string[] = []
    const failure = new Error('scheduler-work-failed')
    const scheduler = createScheduler({
      middleware: [namedMiddleware('root', events), namedMiddleware('leaf', events)],
    })

    await expect(scheduler.run({ scope: 'case' }, async () => {
      events.push('work')
      throw failure
    })).rejects.toBe(failure)

    expect(events).toEqual([
      'root:acquire:case',
      'leaf:acquire:case',
      'work',
      'leaf:release:case',
      'root:release:case',
    ])
  })

  it('runs outer release middleware when an inner acquire throws and preserves the original error', async () => {
    const events: string[] = []
    const failure = new Error('scheduler-acquire-failed')
    const scheduler = createScheduler({
      middleware: [
        namedMiddleware('root', events),
        {
          async onAcquire(context) {
            events.push(`leaf:acquire:${context.scope}`)
            throw failure
          },
          async onRelease(context, next) {
            events.push(`leaf:release:${context.scope}`)
            await next()
          },
        },
      ],
    })

    await expect(scheduler.run({ scope: 'case' }, async () => {
      events.push('work')
    })).rejects.toBe(failure)

    expect(events).toEqual([
      'root:acquire:case',
      'leaf:acquire:case',
      'root:release:case',
    ])
  })

  it('releases the slot when work fails', async () => {
    const scheduler = createScheduler({ concurrency: { case: 1 } })

    await expect(scheduler.run({ scope: 'case' }, async () => {
      throw new Error('failed')
    })).rejects.toThrowError('failed')

    await expect(scheduler.run({ scope: 'case' }, async () => 'next')).resolves.toBe('next')
  })

  it('throws a scheduler-owned error for invalid pool sizes', () => {
    expect(() => createScheduler({ concurrency: { case: 0 } }))
      .toThrowError('Invalid scheduler concurrency for "case": 0')
    expect(() => createScheduler({ concurrency: { project: Number.POSITIVE_INFINITY } }))
      .toThrowError('Invalid scheduler concurrency for "project": Infinity')
    expect(() => createScheduler().child({ concurrency: { task: -1 } }))
      .toThrowError('Invalid scheduler concurrency for "task": -1')
    expect(() => createScheduler({ concurrency: { task: 1.5 } }))
      .toThrowError('Invalid scheduler concurrency for "task": 1.5')
  })
})

/**
 * Work items that start when admitted and settle only when the test releases them.
 */
function createControlledWork() {
  const releases = new Map<string, () => void>()
  const started: string[] = []
  let active = 0
  let peak = 0
  let releasingAll = false

  return {
    get peak() {
      return peak
    },
    release(name: string) {
      releases.get(name)?.()
      releases.delete(name)
    },
    releaseAll() {
      // Work admitted after this call settles at once.
      releasingAll = true
      for (const resolve of releases.values()) {
        resolve()
      }
      releases.clear()
    },
    start(name: string) {
      return async () => {
        started.push(name)
        active += 1
        peak = Math.max(peak, active)
        if (!releasingAll) {
          await new Promise<void>(resolve => releases.set(name, resolve))
        }
        active -= 1
      }
    },
    started,
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function namedMiddleware(name: string, events: string[]): SchedulerMiddleware {
  return {
    async onAcquire(context, next) {
      events.push(`${name}:acquire:${context.scope}`)
      await next()
    },
    async onRelease(context, next) {
      events.push(`${name}:release:${context.scope}`)
      await next()
    },
  }
}

function recordingMiddleware(contexts: SchedulerScopeContext[]): SchedulerMiddleware {
  return {
    async onAcquire(context, next) {
      contexts.push(context)
      await next()
    },
  }
}

import type { RunResult } from './aggregate'
import type { ScheduledTaskExecutor } from './run'
import type { ScheduledTask } from './schedule'

import { describe, expect, it, vi } from 'vitest'

import { runScheduledTasks } from './run'

function createScheduledTaskMatrix() {
  return {
    eval: {},
    meta: {
      evalRowId: 'default',
      runRowId: 'difficulty=rapid',
    },
    run: {
      difficulty: 'rapid',
    },
  }
}

function createScheduledTask() {
  return {
    entry: {
      description: 'desc',
      directory: 'dir',
      filePath: '/tmp/entry.eval.ts',
      id: 'entry-1',
      name: 'entry-1',
    },
    id: 'task-1',
    matrix: createScheduledTaskMatrix(),
    inferenceExecutor: {
      id: 'openai:gpt-4.1-mini',
    },
  } as const
}

function createSuccessfulRunResult(task: ScheduledTask): RunResult {
  return {
    entryId: task.entry.id,
    id: task.id,
    matrix: task.matrix,
    inferenceExecutorId: task.inferenceExecutor.id,
    scores: [{ kind: 'exact', score: 1 }],
  }
}

describe('runScheduledTasks', () => {
  it('emits task lifecycle hooks around a successful executor call', async () => {
    const events: string[] = []
    const tasks = [createScheduledTask()] as const

    const executor: ScheduledTaskExecutor = async (task) => {
      events.push(`executor:${task.id}`)
      return {
        entryId: task.entry.id,
        id: task.id,
        matrix: task.matrix,
        inferenceExecutorId: task.inferenceExecutor.id,
        scores: [
          { kind: 'exact', score: 1 },
        ],
      }
    }

    await runScheduledTasks(tasks, executor, {
      onTaskEnd(task, state) {
        events.push(`end:${task.id}:${state}`)
      },
      onTaskStart(task) {
        events.push(`start:${task.id}`)
      },
    })

    expect(events).toEqual([
      'start:task-1',
      'executor:task-1',
      'end:task-1:passed',
    ])
  })

  it('emits a failed task end hook before rethrowing executor errors', async () => {
    // ROOT CAUSE:
    //
    // The runner previously called the executor directly and rethrew on failure
    // without any lifecycle notifications, so task observers could not see the
    // failure boundary.
    //
    // We fixed this by emitting `onTaskStart` before execution and
    // `onTaskEnd(..., 'failed')` in the rejection path before rethrowing.
    const events: string[] = []
    const executor = vi.fn(async () => {
      events.push('executor')
      throw new Error('boom')
    })

    await expect(runScheduledTasks([createScheduledTask()], executor, {
      onTaskEnd(task, state) {
        events.push(`end:${task.id}:${state}`)
      },
      onTaskStart(task) {
        events.push(`start:${task.id}`)
      },
    })).rejects.toThrow('Runner task "task-1" failed: boom')

    expect(events).toEqual([
      'start:task-1',
      'executor',
      'end:task-1:failed',
    ])
  })

  it('wraps createExecutionContext failures as runner execution errors', async () => {
    const executor = vi.fn()

    await expect(runScheduledTasks([createScheduledTask()], executor, {
      createExecutionContext() {
        throw new Error('context boom')
      },
    })).rejects.toMatchObject({
      cause: expect.any(Error),
      message: 'Runner task "task-1" failed: context boom',
      name: 'RunnerExecutionError',
      taskId: 'task-1',
    })

    expect(executor).not.toHaveBeenCalled()
  })

  it('wraps start hook failures before task execution begins', async () => {
    const events: string[] = []
    const executor: ScheduledTaskExecutor = vi.fn(async (task) => {
      events.push('executor')
      return createSuccessfulRunResult(task)
    })

    await expect(runScheduledTasks([createScheduledTask()], executor, {
      onTaskEnd(task, state) {
        events.push(`end:${task.id}:${state}`)
      },
      onTaskStart(task) {
        events.push(`start:${task.id}`)
        throw new Error('start boom')
      },
    })).rejects.toMatchObject({
      cause: expect.any(Error),
      message: 'Runner task "task-1" failed: start boom',
      name: 'RunnerExecutionError',
      taskId: 'task-1',
    })

    expect(events).toEqual(['start:task-1'])
    expect(executor).not.toHaveBeenCalled()
  })

  it('does not emit a failed terminal event when the passed end hook throws', async () => {
    const events: string[] = []

    await expect(runScheduledTasks([createScheduledTask()], async (task) => {
      events.push(`executor:${task.id}`)
      return createSuccessfulRunResult(task)
    }, {
      onTaskEnd(task, state) {
        events.push(`end:${task.id}:${state}`)
        if (state === 'passed') {
          throw new Error('end passed boom')
        }
      },
      onTaskStart(task) {
        events.push(`start:${task.id}`)
      },
    })).rejects.toMatchObject({
      cause: expect.any(Error),
      message: 'Runner task "task-1" failed: end passed boom',
      name: 'RunnerExecutionError',
      taskId: 'task-1',
    })

    expect(events).toEqual([
      'start:task-1',
      'executor:task-1',
      'end:task-1:passed',
    ])
  })

  it('preserves the executor failure when the failed end hook also throws', async () => {
    const events: string[] = []

    await expect(runScheduledTasks([createScheduledTask()], async () => {
      events.push('executor')
      throw new Error('boom')
    }, {
      onTaskEnd(task, state) {
        events.push(`end:${task.id}:${state}`)
        if (state === 'failed') {
          throw new Error('end failed boom')
        }
      },
      onTaskStart(task) {
        events.push(`start:${task.id}`)
      },
    })).rejects.toMatchObject({
      cause: expect.any(Error),
      message: 'Runner task "task-1" failed: boom',
      name: 'RunnerExecutionError',
      taskId: 'task-1',
    })

    expect(events).toEqual([
      'start:task-1',
      'executor',
      'end:task-1:failed',
    ])
  })
})

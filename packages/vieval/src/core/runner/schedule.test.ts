import type { CollectedEvalEntry, EvalDefinition, TaskDefinition } from '../../config'

import { describe, expect, it } from 'vitest'

import { createRunnerSchedule } from './schedule'

function createEntry(
  id: string,
  definition: Partial<EvalDefinition> = {},
): CollectedEvalEntry {
  return {
    description: `${id} description`,
    directory: '',
    filePath: `/tmp/${id}.eval.ts`,
    id,
    name: id,
    ...definition,
  }
}

function createTask(definition: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: definition.id ?? 'task',
    run: definition.run ?? (() => ({ scores: [] })),
    ...definition,
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function createRowIdSegment(matrix: Record<string, string>): string {
  const normalized = Object.entries(matrix)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([axis, value]) => `${encodeSegment(axis)}=${encodeSegment(value)}`)
    .join('&')

  return normalized.length > 0 ? normalized : 'default'
}

function createExpectedTaskId(
  entryId: string,
  inferenceExecutorId: string,
  runMatrix: Record<string, string>,
  evalMatrix: Record<string, string>,
): string {
  return [
    encodeSegment(entryId),
    encodeSegment(inferenceExecutorId),
    `run=${encodeSegment(createRowIdSegment(runMatrix))}`,
    `eval=${encodeSegment(createRowIdSegment(evalMatrix))}`,
  ].join('::')
}

function createExpectedMatrix(
  runMatrix: Record<string, string>,
  evalMatrix: Record<string, string>,
) {
  return {
    eval: evalMatrix,
    meta: {
      evalRowId: createRowIdSegment(evalMatrix),
      runRowId: createRowIdSegment(runMatrix),
    },
    run: runMatrix,
  }
}

describe('createRunnerSchedule', () => {
  it('expands inferenceExecutor and matrix combinations for every collected entry', () => {
    const schedule = createRunnerSchedule({
      entries: [
        createEntry('agent/chess-commentary/chess-commentary'),
      ],
      runMatrix: {
        difficulty: ['rapid', 'blitz'],
        promptStyle: ['concise', 'verbose'],
      },
      inferenceExecutors: [
        { id: 'openai:gpt-4.1-mini' },
        { id: 'openai:gpt-4.1' },
      ],
    })

    expect(schedule).toHaveLength(8)
    expect(schedule.map(task => task.id)).toEqual([
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1-mini',
        { difficulty: 'rapid', promptStyle: 'concise' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1-mini',
        { difficulty: 'rapid', promptStyle: 'verbose' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1-mini',
        { difficulty: 'blitz', promptStyle: 'concise' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1-mini',
        { difficulty: 'blitz', promptStyle: 'verbose' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1',
        { difficulty: 'rapid', promptStyle: 'concise' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1',
        { difficulty: 'rapid', promptStyle: 'verbose' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1',
        { difficulty: 'blitz', promptStyle: 'concise' },
        {},
      ),
      createExpectedTaskId(
        'agent/chess-commentary/chess-commentary',
        'openai:gpt-4.1',
        { difficulty: 'blitz', promptStyle: 'verbose' },
        {},
      ),
    ])
    expect(schedule[0]?.matrix).toEqual(createExpectedMatrix(
      {
        difficulty: 'rapid',
        promptStyle: 'concise',
      },
      {},
    ))
    expect(schedule[7]?.matrix).toEqual(createExpectedMatrix(
      {
        difficulty: 'blitz',
        promptStyle: 'verbose',
      },
      {},
    ))
  })

  it('returns one task per entry and inferenceExecutor when the matrix is omitted', () => {
    const schedule = createRunnerSchedule({
      entries: [
        createEntry('alpha'),
        createEntry('beta'),
      ],
      inferenceExecutors: [
        { id: 'inferenceExecutor-a' },
      ],
    })

    expect(schedule).toEqual([
      {
        entry: createEntry('alpha'),
        id: createExpectedTaskId('alpha', 'inferenceExecutor-a', {}, {}),
        matrix: createExpectedMatrix({}, {}),
        inferenceExecutor: { id: 'inferenceExecutor-a' },
      },
      {
        entry: createEntry('beta'),
        id: createExpectedTaskId('beta', 'inferenceExecutor-a', {}, {}),
        matrix: createExpectedMatrix({}, {}),
        inferenceExecutor: { id: 'inferenceExecutor-a' },
      },
    ])
  })

  it('isolates matrix objects between tasks', () => {
    const schedule = createRunnerSchedule({
      entries: [createEntry('alpha'), createEntry('beta')],
      runMatrix: {
        difficulty: ['rapid'],
      },
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
    })

    expect(schedule).toHaveLength(2)
    expect(schedule[0]?.matrix).not.toBe(schedule[1]?.matrix)

    if (schedule[0] == null || schedule[1] == null) {
      throw new Error('Expected two scheduled tasks.')
    }

    schedule[0].matrix.run.difficulty = 'mutated'

    expect(schedule[0].matrix).toEqual({
      eval: {},
      meta: {
        evalRowId: 'default',
        runRowId: 'difficulty=rapid',
      },
      run: {
        difficulty: 'mutated',
      },
    })
    expect(schedule[1].matrix).toEqual(createExpectedMatrix({ difficulty: 'rapid' }, {}))
  })

  it('escapes delimiters in task ids to avoid collisions', () => {
    const schedule = createRunnerSchedule({
      entries: [
        createEntry('entry::alpha'),
        createEntry('entry'),
      ],
      runMatrix: {
        'axis::name': ['left::right', 'left'],
        'axis': ['name=left', 'name'],
      },
      inferenceExecutors: [
        { id: 'inferenceExecutor=value' },
        { id: 'inferenceExecutor' },
      ],
    })

    const taskIds = schedule.map(task => task.id)

    expect(new Set(taskIds).size).toBe(taskIds.length)
    expect(taskIds).toContain(createExpectedTaskId(
      'entry::alpha',
      'inferenceExecutor=value',
      {
        'axis': 'name=left',
        'axis::name': 'left::right',
      },
      {},
    ))
    expect(taskIds).not.toContain('entry::alpha::inferenceExecutor=value::run=axis::name=left::right&axis=name=left::eval=default')
  })

  it('encodes row-id segments before joining so raw-delimiter collisions stay unique', () => {
    const schedule = createRunnerSchedule({
      entries: [createEntry('alpha')],
      evalMatrix: {
        'a=b&c': ['d'],
      },
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        a: ['b'],
        c: ['d'],
      },
    })

    expect(schedule).toHaveLength(1)
    expect(schedule[0]?.matrix.meta).toEqual({
      evalRowId: 'a%3Db%26c=d',
      runRowId: 'a=b&c=d',
    })
    expect(schedule[0]?.matrix.meta.runRowId).not.toBe(schedule[0]?.matrix.meta.evalRowId)
  })

  it('expands runMatrix and evalMatrix dimensions together', () => {
    const schedule = createRunnerSchedule({
      entries: [createEntry('alpha')],
      evalMatrix: {
        rubric: ['strict', 'lenient'],
      },
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        scenario: ['baseline'],
      },
    })

    expect(schedule).toHaveLength(2)
    expect(schedule.map(task => task.id)).toEqual([
      createExpectedTaskId('alpha', 'inferenceExecutor-a', { scenario: 'baseline' }, { rubric: 'strict' }),
      createExpectedTaskId('alpha', 'inferenceExecutor-a', { scenario: 'baseline' }, { rubric: 'lenient' }),
    ])
    expect(schedule.map(task => task.matrix)).toEqual([
      createExpectedMatrix(
        {
          scenario: 'baseline',
        },
        {
          rubric: 'strict',
        },
      ),
      createExpectedMatrix(
        {
          scenario: 'baseline',
        },
        {
          rubric: 'lenient',
        },
      ),
    ])
  })

  it('merges project, eval, and task scoped matrices in deterministic scope order', () => {
    const schedule = createRunnerSchedule({
      entries: [
        createEntry('alpha', {
          matrix: {
            evalMatrix: {
              override: {
                rubric: ['strict'],
              },
            },
            runMatrix: {
              extend: {
                promptStyle: ['concise'],
              },
              override: {
                scenario: ['eval-scenario'],
              },
            },
          },
          task: createTask({
            id: 'task-alpha',
            matrix: {
              evalMatrix: {
                extend: {
                  evaluator: ['default-judge'],
                },
              },
              runMatrix: {
                override: {
                  model: ['task-model'],
                },
              },
            },
          }),
        }),
      ],
      evalMatrix: {
        extend: {
          rubric: ['default'],
        },
      },
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        extend: {
          model: ['project-model'],
          scenario: ['project-scenario'],
        },
      },
    })

    expect(schedule).toHaveLength(1)
    expect(schedule[0]?.matrix).toEqual(createExpectedMatrix(
      {
        model: 'task-model',
        promptStyle: 'concise',
        scenario: 'eval-scenario',
      },
      {
        evaluator: 'default-judge',
        rubric: 'strict',
      },
    ))
    expect(schedule[0]?.id).toBe(createExpectedTaskId(
      'alpha',
      'inferenceExecutor-a',
      {
        model: 'task-model',
        promptStyle: 'concise',
        scenario: 'eval-scenario',
      },
      {
        evaluator: 'default-judge',
        rubric: 'strict',
      },
    ))
  })

  it('applies disable then extend then override within one matrix layer', () => {
    const schedule = createRunnerSchedule({
      entries: [createEntry('alpha', {
        matrix: {
          runMatrix: {
            disable: ['temperature'],
            extend: {
              model: ['extended-model'],
              promptStyle: ['concise'],
            },
            override: {
              model: ['override-model'],
            },
          },
        },
      })],
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        model: ['baseline-model'],
        scenario: ['control'],
        temperature: ['low'],
      },
    })

    expect(schedule).toHaveLength(1)
    expect(schedule[0]?.matrix).toEqual(createExpectedMatrix(
      {
        model: 'override-model',
        promptStyle: 'concise',
        scenario: 'control',
      },
      {},
    ))
  })

  it('treats disable-only objects as layer controls', () => {
    const schedule = createRunnerSchedule({
      entries: [createEntry('alpha', {
        matrix: {
          runMatrix: {
            disable: ['temperature'],
          },
        },
      })],
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        model: ['baseline-model'],
        temperature: ['low'],
      },
    })

    expect(schedule).toHaveLength(1)
    expect(schedule[0]?.matrix).toEqual(createExpectedMatrix(
      {
        model: 'baseline-model',
      },
      {},
    ))
    expect(schedule[0]?.id).toBe(createExpectedTaskId(
      'alpha',
      'inferenceExecutor-a',
      {
        model: 'baseline-model',
      },
      {},
    ))
  })

  it('derives stable run/eval id segments regardless of axis declaration order', () => {
    const forwardSchedule = createRunnerSchedule({
      entries: [createEntry('alpha')],
      evalMatrix: {
        promptStyle: ['concise'],
        rubric: ['strict'],
      },
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        model: ['gpt-4.1-mini'],
        scenario: ['baseline'],
      },
    })
    const reversedSchedule = createRunnerSchedule({
      entries: [createEntry('alpha')],
      evalMatrix: {
        rubric: ['strict'],
        promptStyle: ['concise'],
      },
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        scenario: ['baseline'],
        model: ['gpt-4.1-mini'],
      },
    })

    expect(forwardSchedule.map(task => task.id)).toEqual(reversedSchedule.map(task => task.id))
    expect(forwardSchedule[0]?.id).toBe(createExpectedTaskId(
      'alpha',
      'inferenceExecutor-a',
      {
        model: 'gpt-4.1-mini',
        scenario: 'baseline',
      },
      {
        promptStyle: 'concise',
        rubric: 'strict',
      },
    ))
  })

  it('throws for ambiguous mixed-key matrix objects', () => {
    expect(() => createRunnerSchedule({
      entries: [createEntry('alpha')],
      inferenceExecutors: [{ id: 'inferenceExecutor-a' }],
      runMatrix: {
        disable: ['disabled-axis'],
        scenario: ['baseline'],
      },
    })).toThrow('Ambiguous matrix definition')
  })
})

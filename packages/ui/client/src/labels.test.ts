import type { MatrixAxes } from './labels'

import { describe, expect, it } from 'vitest'

import { attemptDate, attemptLabel, differingAxes, experimentLabel, formatAxisValues, formatFinish, mergeMatrices, relativeTime, runLabel, shortRunHash } from './labels'

describe('formatAxisValues', () => {
  /**
   * @example
   * expect(formatAxisValues(['3', '1', '2', '5'])).toBe('1–3, 5')
   */
  it('collapses consecutive integers into ranges, in numeric order', () => {
    expect(formatAxisValues(['3', '1', '2', '5'])).toBe('1–3, 5')
    expect(formatAxisValues(['10', '2'])).toBe('2, 10')
    expect(formatAxisValues(['1', '2'])).toBe('1, 2')
  })

  /**
   * @example
   * expect(formatAxisValues(['o3', 'gpt-5.5'])).toBe('gpt-5.5, o3')
   */
  it('lists other values alphabetically', () => {
    expect(formatAxisValues(['o3', 'gpt-5.5', 'o3'])).toBe('gpt-5.5, o3')
    expect(formatAxisValues([])).toBe('')
  })
})

describe('experimentLabel', () => {
  /**
   * @example
   * expect(experimentLabel('matrix-run-model-gpt-5.5-repeat-1', matrix).text).toBe('model gpt-5.5 · repeat 1–3')
   */
  it('names a default experiment by its matrix', () => {
    const label = experimentLabel('matrix-run-model-gpt-5.5-repeat-1--run-model-gpt-5.5-repeat-2', { model: ['gpt-5.5'], repeat: ['1', '2', '3'] })

    expect(label.text).toBe('model gpt-5.5 · repeat 1–3')
    expect(label.textIsMatrix).toBe(true)
  })

  /**
   * @example
   * expect(experimentLabel('auv-c759d695', matrix).text).toBe('auv-c759d695')
   */
  it('keeps a chosen experiment id and adds the matrix as chips', () => {
    const label = experimentLabel('auv-c759d695', { model: ['gpt-5.5'], repeat: ['1'] })

    expect(label.text).toBe('auv-c759d695')
    expect(label.textIsMatrix).toBe(false)
    expect(label.chips).toEqual([{ axis: 'model', values: 'gpt-5.5' }, { axis: 'repeat', values: '1' }])
  })

  /**
   * @example
   * expect(experimentLabel('matrix-x', {}).text).toBe('matrix-x')
   */
  it('falls back to the id when the runs carry no matrix', () => {
    expect(experimentLabel('matrix-run-default', {}).text).toBe('matrix-run-default')
    expect(experimentLabel('matrix-run-default', undefined).chips).toEqual([])
  })
})

describe('mergeMatrices', () => {
  /**
   * @example
   * expect(mergeMatrices([{ repeat: ['2'] }, { repeat: ['1'] }])).toEqual({ repeat: ['1', '2'] })
   */
  it('unions the axes and values of several runs', () => {
    expect(mergeMatrices([{ model: ['gpt-5.5'], repeat: ['2'] }, { repeat: ['10', '1'] }, undefined])).toEqual({ model: ['gpt-5.5'], repeat: ['1', '2', '10'] })
  })
})

describe('differingAxes', () => {
  /**
   * @example
   * expect(differingAxes([{ asr: ['apple-speech'] }, { asr: ['whisper-1'] }])).toEqual(['asr'])
   */
  it('names the axes whose values change between runs, and an axis only some runs have', () => {
    const runs: MatrixAxes[] = [
      { asr: ['apple-speech'], listener: ['gpt-6-luna'], tts: ['none', 'official'] },
      { asr: ['whisper-1'], listener: ['gpt-6-luna'], tts: ['official', 'none'] },
      { asr: ['whisper-1'], listener: ['gpt-6-luna'], rewrite: ['gpt-6-luna'], tts: ['none', 'official'] },
    ]
    expect(differingAxes(runs)).toEqual(['asr', 'rewrite'])
    expect(differingAxes([runs[1]!, runs[1]!])).toEqual([])
  })
})

describe('attempt and run labels', () => {
  /**
   * @example
   * expect(attemptDate('attempt-2026-10-12T07-11-52-616Z')?.toISOString()).toBe('2026-10-12T07:11:52.616Z')
   */
  it('reads the time of a default attempt id and keeps other ids', () => {
    expect(attemptDate('attempt-2026-10-12T07-11-52-616Z')?.toISOString()).toBe('2026-10-12T07:11:52.616Z')
    expect(attemptDate('nightly')).toBeUndefined()
    expect(attemptLabel('nightly')).toBe('nightly')
    expect(attemptLabel('attempt-2026-10-12T07-11-52-616Z')).toMatch(/^Oct 1[23], \d{2}:\d{2}$/)
  })

  /**
   * @example
   * expect(runLabel({ runKey, startedAt })).toMatch(/· e67c9b33$/)
   */
  it('names a run by its start time and short hash', () => {
    expect(shortRunHash('run-1791789112616-e67c9b33')).toBe('e67c9b33')
    expect(runLabel({ runKey: 'run-1791789112616-e67c9b33', startedAt: '2026-10-12T07:11:52.616Z' })).toMatch(/^Oct 1[23], \d{2}:\d{2} · e67c9b33$/)
    expect(runLabel({ runKey: 'run-1791789112616-e67c9b33' })).toBe('e67c9b33')
  })

  /**
   * @example
   * expect(relativeTime(threeHoursAgo, now)).toBe('3 hours ago')
   */
  it('describes the age of a time in words', () => {
    const now = Date.parse('2026-10-12T10:00:00Z')

    expect(relativeTime(new Date(now - 3 * 3_600_000), now)).toBe('3 hours ago')
    expect(relativeTime(new Date(now - 2 * 86_400_000), now)).toBe('2 days ago')
    expect(relativeTime(new Date(now - 5000), now)).toBe('5 seconds ago')
  })

  // ROOT CAUSE:
  //
  // The run page showed "Expected finish 03:45:46" for a run whose ETA was 1037 h away (Nov 25), because the panel
  // formatted the finish as a time of day only.
  //
  // We fixed this by `formatFinish`: the time of day within a day, the date and time beyond.
  /**
   * @example
   * expect(formatFinish('2026-11-25T03:45:00Z', now)).toMatch(/^Nov 25, \d{2}:\d{2}$/)
   */
  it('adds the date to an expected finish more than a day away', () => {
    const now = Date.parse('2026-10-12T10:00:00Z')

    expect(formatFinish('2026-11-25T03:45:00Z', now)).toMatch(/^Nov 2[45], \d{2}:\d{2}$/)
    expect(formatFinish('2026-10-12T13:00:00Z', now)).toMatch(/^\d{2}:\d{2}$/)
  })
})

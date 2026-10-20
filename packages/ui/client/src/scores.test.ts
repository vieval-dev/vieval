import type { HeadlineResult, ScoreDefinition, ScoreSummary } from '../../src/shared/contract'

import { describe, expect, it } from 'vitest'

import { caseScoreText, completionText, formulaText, gradersDiffer, graderText, headlineOf, headlineValue, headlineView, isGraderCall, primaryScoreName, unscoredText } from './scores'

/** The scores of airi's `tts-speech-formula` eval, the first eval migrated to named scores. */
const definitions: ScoreDefinition[] = [
  { label: { 'en': 'Written back correctly', 'zh-Hans': '听写正确' }, name: 'tts_speech_formula.correct' },
  { grader: { id: 'judge', kind: 'model', model: 'gpt-5.5', reducer: 'median', votes: 3 }, label: { 'en': 'Natural reading', 'zh-Hans': '读法自然' }, name: 'tts_speech_formula.natural' },
  {
    combine: { inputs: [{ name: 'tts_speech_formula.correct' }, { atLeast: 0.5, name: 'tts_speech_formula.natural' }], kind: 'all' },
    description: { 'en': 'Written back correctly and read naturally.', 'zh-Hans': '听写正确，并且读法自然。' },
    label: { 'en': 'Pass', 'zh-Hans': '通过' },
    name: 'tts_speech_formula.pass',
    primary: true,
  },
]

function summary(name: string, mean: null | number, unscored: Record<string, number> = {}): ScoreSummary {
  return { mean, n: 40, name, sum: (mean ?? 0) * 40, total: 42, unscored }
}

const completion = summary('completion', 0.968, { errored: 4 })

describe('headlineView', () => {
  /**
   * @example
   * expect(headlineView(result, definitions).label).toBe('Pass')
   */
  it('names a score headline by the localized label of the primary score', () => {
    const result: HeadlineResult = { completion, headline: { kind: 'score', score: summary('tts_speech_formula.pass', 0.875) } }
    const view = headlineView(result, definitions)

    expect(view.label).toBe('Pass')
    expect(view.summary.mean).toBe(0.875)
    expect(view.definition?.primary).toBe(true)
    expect(view.tasks).toEqual([])
  })

  /**
   * @example
   * expect(headlineView(result, []).label).toBe('Passed cases')
   */
  it('labels the passed share when no score was recorded', () => {
    const result: HeadlineResult = { completion, headline: { kind: 'passed-cases', score: summary('passed', 0.5) } }

    expect(headlineView(result, []).label).toBe('Passed cases')
    expect(headlineValue(result)).toBe(0.5)
  })

  /**
   * @example
   * expect(view.tasks.map(task => task.label)).toEqual(['Pass', 'Natural reading'])
   */
  it('lists each task\'s primary score and keeps the completion rate as the value of a per-task headline', () => {
    const result: HeadlineResult = {
      completion,
      headline: { kind: 'per-task', tasks: [{ score: summary('tts_speech_formula.pass', 0.8), taskId: 'en' }, { score: summary('tts_speech_formula.natural', 0.6), taskId: 'zh' }] },
    }
    const view = headlineView(result, definitions)

    expect(view.label).toBe('completed')
    expect(view.summary.mean).toBe(0.968)
    expect(view.tasks.map(task => task.label)).toEqual(['Pass', 'Natural reading'])
    expect(view.tasks.map(task => task.taskId)).toEqual(['en', 'zh'])
    expect(headlineValue(result)).toBeNull()
  })
})

describe('headlineOf', () => {
  /**
   * @example
   * expect(headlineOf(scoring).headline.kind).toBe('score')
   */
  it('reads a task\'s primary score as its headline, and the passed cases without one', () => {
    const scoring = { completion, passed: summary('passed', 0.9), primary: 'tts_speech_formula.pass', scores: [summary('tts_speech_formula.pass', 0.875)] }

    expect(headlineOf(scoring)).toEqual({ completion, headline: { kind: 'score', score: scoring.scores[0] } })
    expect(headlineOf({ ...scoring, primary: undefined })).toEqual({ completion, headline: { kind: 'passed-cases', score: scoring.passed } })
  })
})

describe('score texts', () => {
  /**
   * @example
   * expect(completionText(completion)).toBe('completed 96.8% (4 errored)')
   */
  it('formats the completion rate with the cases that produced no result', () => {
    expect(completionText(completion)).toBe('completed 96.8% (4 errored)')
    expect(completionText(summary('completion', 1))).toBe('completed 100.0%')
    expect(completionText(summary('completion', 0.9, { errored: 1, timeout: 2 }))).toBe('completed 90.0% (1 errored, 2 timed out)')
  })

  /**
   * @example
   * expect(formulaText(definitions[2], definitions)).toBe('all of: Written back correctly, Natural reading ≥ 50%')
   */
  it('spells out the formula of a derived score with the labels of its inputs', () => {
    expect(formulaText(definitions[2], definitions)).toBe('all of: Written back correctly, Natural reading ≥ 50%')
    expect(formulaText({ combine: { inputs: [{ name: 'a', weight: 2 }, { name: 'b', weight: 1 }], kind: 'weighted' }, name: 'w' }, [])).toBe('weighted: a ×2, b ×1')
    expect(formulaText({ combine: { inputs: [{ name: 'a' }, { name: 'b' }], kind: 'mean' }, name: 'm' }, [])).toBe('mean of: a, b')
    expect(formulaText(definitions[0], definitions)).toBeUndefined()
  })

  /**
   * @example
   * expect(graderText({ kind: 'model', model: 'gpt-5.5', reducer: 'median', votes: 3 })).toBe('model · gpt-5.5 · 3 votes, median')
   */
  it('formats what produced a score', () => {
    expect(graderText({ kind: 'model', model: 'gpt-5.5', reducer: 'median', votes: 3 })).toBe('model · gpt-5.5 · 3 votes, median')
    expect(graderText({ kind: 'rule', version: '2' })).toBe('rule · version 2')
    expect(graderText({ kind: 'external' })).toBe('external')
  })

  /**
   * @example
   * expect(unscoredText({ grader_failed: 2, refusal: 1 })).toBe('2 grader failed, 1 refusal')
   */
  it('labels the suggested unscored reasons and keeps other reasons as written', () => {
    expect(unscoredText({ grader_failed: 2, refusal: 1 })).toBe('2 grader failed, 1 refusal')
    expect(unscoredText({ 'input_unscored': 3, 'judge timed out': 1 })).toBe('3 input unscored, 1 judge timed out')
    expect(caseScoreText({ unscored: { natural: 'invalid_response' }, values: { pass: 1 } }, 'natural')).toBe('invalid response')
    expect(caseScoreText({ unscored: {}, values: { pass: 1 } }, 'pass')).toBe('100.0%')
    expect(caseScoreText({ unscored: {}, values: {} }, 'pass')).toBe('—')
  })
})

describe('graders', () => {
  /**
   * @example
   * expect(gradersDiffer({ kind: 'model', model: 'a' }, { kind: 'model', model: 'b' })).toBe(true)
   */
  it('tells graders apart by kind, model, and version, not by votes', () => {
    expect(gradersDiffer({ kind: 'model', model: 'a' }, { kind: 'model', model: 'b' })).toBe(true)
    expect(gradersDiffer({ kind: 'rule', version: '1' }, { kind: 'rule', version: '2' })).toBe(true)
    expect(gradersDiffer({ kind: 'model', model: 'a', votes: 3 }, { kind: 'model', model: 'a', votes: 5 })).toBe(false)
    expect(gradersDiffer(undefined, { kind: 'rule' })).toBe(false)
  })

  /**
   * @example
   * expect(isGraderCall({ provider: { id: 'judge' } }, 'judge')).toBe(true)
   */
  it('matches a grader\'s model calls by provider id or request role', () => {
    expect(isGraderCall({ provider: { id: 'judge', model: 'gpt-5.5' } }, 'judge')).toBe(true)
    expect(isGraderCall({ provider: { id: 'openai' }, request: { role: 'judge' } }, 'judge')).toBe(true)
    expect(isGraderCall({ provider: { id: 'openai' }, request: { step: 1 } }, 'judge')).toBe(false)
  })
})

describe('primaryScoreName', () => {
  /**
   * @example
   * expect(primaryScoreName(definitions, names)).toBe('tts_speech_formula.pass')
   */
  it('picks the primary score, else the only score, else none', () => {
    const names = definitions.map(definition => definition.name)

    expect(primaryScoreName(definitions, names)).toBe('tts_speech_formula.pass')
    expect(primaryScoreName([], ['only'])).toBe('only')
    expect(primaryScoreName([], ['a', 'b'])).toBeUndefined()
    expect(primaryScoreName([{ name: 'a', primary: true }, { name: 'b', primary: true }], ['a', 'b'])).toBeUndefined()
  })
})

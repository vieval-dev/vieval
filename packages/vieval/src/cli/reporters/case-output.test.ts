import { describe, expect, it } from 'vitest'

import { CaseOutputCollector, CaseOutputLines, createCaseOutputReporter, truncateToWidth } from './case-output'

/**
 * @example
 * describe('caseOutputLines', () => {})
 */
describe('caseOutputLines', () => {
  /**
   * @example
   * it('joins chunks that split a line and keeps an unterminated last line', () => {})
   */
  it('joins chunks that split a line and keeps an unterminated last line', () => {
    const output = new CaseOutputLines()

    output.append('stdout', 'step 1\nste')
    output.append('stdout', 'p 2\npartial')

    /**
     * @example
     * expect(output.lines).toEqual([{ stream: 'stdout', text: 'step 1' }, ...])
     */
    expect(output.lines).toEqual([
      { stream: 'stdout', text: 'step 1' },
      { stream: 'stdout', text: 'step 2' },
      { stream: 'stdout', text: 'partial' },
    ])
  })

  /**
   * @example
   * it('ends a pending partial line when the other stream writes', () => {})
   */
  it('ends a pending partial line when the other stream writes', () => {
    const output = new CaseOutputLines()

    output.append('stdout', 'no newline')
    output.append('stderr', 'warning\n')

    /**
     * @example
     * expect(output.lines).toEqual([{ stream: 'stdout', text: 'no newline' }, { stream: 'stderr', text: 'warning' }])
     */
    expect(output.lines).toEqual([
      { stream: 'stdout', text: 'no newline' },
      { stream: 'stderr', text: 'warning' },
    ])
  })

  /**
   * @example
   * it('removes colors, cursor control, and carriage-return redraws', () => {})
   */
  it('removes colors, cursor control, and carriage-return redraws', () => {
    const output = new CaseOutputLines()

    output.append('stdout', '\u001B[32mok\u001B[39m\nprogress 10%\rprogress 100%\n\u001B[2Kcleared\n')

    /**
     * @example
     * expect(output.lines.map(line => line.text)).toEqual(['ok', 'progress 100%', 'cleared'])
     */
    expect(output.lines.map(line => line.text)).toEqual(['ok', 'progress 100%', 'cleared'])
  })
})

/**
 * @example
 * describe('truncateToWidth', () => {})
 */
describe('truncateToWidth', () => {
  /**
   * @example
   * it('cuts by display width so wide characters fit one terminal row', () => {})
   */
  it('cuts by display width so wide characters fit one terminal row', () => {
    /**
     * @example
     * expect(truncateToWidth('short', 10)).toBe('short')
     */
    expect(truncateToWidth('short', 10)).toBe('short')
    expect(truncateToWidth('a long output line', 10)).toBe('a long ou…')
    /**
     * @example
     * expect(truncateToWidth('打开设置页面', 7)).toBe('打开设…')
     */
    expect(truncateToWidth('打开设置页面', 7)).toBe('打开设…')
  })
})

function createCollector(options: { collapse?: boolean, holdUntilFlush?: boolean } = {}): { collector: CaseOutputCollector, writes: string[] } {
  const writes: string[] = []
  const collector = new CaseOutputCollector({
    collapse: options.collapse ?? false,
    colors: false,
    getNow: () => 0,
    holdUntilFlush: options.holdUntilFlush ?? false,
    write: value => writes.push(value),
  })
  collector.onTaskQueued({ displayName: 'task', projectName: 'project', taskId: 'task-id' })
  return { collector, writes }
}

function writeLines(collector: CaseOutputCollector, caseId: string, count: number): void {
  for (let line = 1; line <= count; line += 1) {
    collector.onCaseOutput({ caseId, content: `line ${line}\n`, stream: 'stdout', taskId: 'task-id' })
  }
}

/**
 * @example
 * describe('caseOutputCollector', () => {})
 */
describe('caseOutputCollector', () => {
  /**
   * @example
   * it('prints interleaved output of concurrent cases as one block per case when each ends', () => {})
   */
  it('prints interleaved output of concurrent cases as one block per case when each ends', () => {
    const { collector, writes } = createCollector()

    collector.onCaseStart({ caseId: 'a', caseName: 'case a', taskId: 'task-id' })
    collector.onCaseStart({ caseId: 'b', caseName: 'case b', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: 'a', content: 'a1\n', stream: 'stdout', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: 'b', content: 'b1\n', stream: 'stdout', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: 'a', content: 'a2\n', stream: 'stderr', taskId: 'task-id' })
    collector.onCaseEnd({ caseId: 'b', state: 'passed', taskId: 'task-id' })
    collector.onCaseEnd({ caseId: 'a', errorMessage: 'boom', state: 'failed', taskId: 'task-id' })

    /**
     * @example
     * expect(writes).toEqual(['|project| task > case b\n│ b1\n└─ Done in 0ms\n', ...])
     */
    expect(writes).toEqual([
      '|project| task > case b\n│ b1\n└─ Done in 0ms\n',
      '|project| task > case a\n│ a1\n│ a2\n└─ Failed in 0ms: boom\n',
    ])
  })

  /**
   * @example
   * it('collapses a passed case to its last 10 lines but keeps the full output of a failed case', () => {})
   */
  it('collapses a passed case to its last 10 lines but keeps the full output of a failed case', () => {
    const { collector, writes } = createCollector({ collapse: true })

    for (const [caseId, state] of [['passed-case', 'passed'], ['failed-case', 'failed']] as const) {
      collector.onCaseStart({ caseId, caseName: caseId, taskId: 'task-id' })
      writeLines(collector, caseId, 12)
      collector.onCaseEnd({ caseId, state, taskId: 'task-id' })
    }

    /**
     * @example
     * expect(writes[0]?.split('\n').slice(0, 3)).toEqual(['|project| task > passed-case', '[2 lines collapsed]', '│ line 3'])
     */
    expect(writes[0]?.split('\n').slice(0, 3)).toEqual(['|project| task > passed-case', '[2 lines collapsed]', '│ line 3'])
    /**
     * @example
     * expect(writes[1]).not.toContain('collapsed')
     */
    expect(writes[1]).not.toContain('collapsed')
    expect(writes[1]).toContain('│ line 1\n')
  })

  /**
   * @example
   * it('holds blocks until flush and prints them grouped by task and case order', () => {})
   */
  it('holds blocks until flush and prints them grouped by task and case order', () => {
    const { collector, writes } = createCollector({ holdUntilFlush: true })
    collector.onTaskQueued({ displayName: 'second', taskId: 'task-b' })

    for (const [taskId, caseId] of [['task-b', 'b1'], ['task-id', 'a1'], ['task-id', 'a2']] as const) {
      collector.onCaseStart({ caseId, caseName: caseId, taskId })
      collector.onCaseOutput({ caseId, content: `${caseId}\n`, stream: 'stdout', taskId })
    }
    collector.onCaseEnd({ caseId: 'a2', state: 'passed', taskId: 'task-id' })
    collector.onCaseEnd({ caseId: 'b1', state: 'passed', taskId: 'task-b' })

    /**
     * @example
     * expect(writes).toEqual([])
     */
    expect(writes).toEqual([])

    collector.flush()

    /**
     * @example
     * expect(writes.map(block => block.split('\n')[0])).toEqual(['|project| task > a1', '|project| task > a2', 'second > b1'])
     */
    expect(writes.map(block => block.split('\n')[0])).toEqual(['|project| task > a1', '|project| task > a2', 'second > b1'])
    /**
     * @example
     * expect(writes[0]).toContain('└─ Stopped after 0ms')
     */
    expect(writes[0]).toContain('└─ Stopped after 0ms')
  })

  /**
   * @example
   * it('keeps the case name for output written after the case ended', () => {})
   */
  it('keeps the case name for output written after the case ended', () => {
    const { collector, writes } = createCollector()

    collector.onCaseStart({ caseId: '0:timed-out', caseName: 'timed-out', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: '0:timed-out', content: 'before\n', stream: 'stdout', taskId: 'task-id' })
    collector.onCaseEnd({ caseId: '0:timed-out', state: 'timeout', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: '0:timed-out', content: 'after\n', stream: 'stdout', taskId: 'task-id' })
    collector.flush()

    /**
     * @example
     * expect(writes[1]).toBe('|project| task > timed-out\n│ after\n└─ Wrote more output after the case ended\n')
     */
    expect(writes[1]).toBe('|project| task > timed-out\n│ after\n└─ Wrote more output after the case ended\n')
  })

  /**
   * @example
   * it('marks retries and prints cases of an ended task as stopped', () => {})
   */
  it('marks retries and prints cases of an ended task as stopped', () => {
    const { collector, writes } = createCollector()

    collector.onCaseStart({ caseId: 'flaky', caseName: 'flaky', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: 'flaky', content: 'try 1\n', stream: 'stdout', taskId: 'task-id' })
    collector.onCaseStart({ autoRetry: 2, caseId: 'flaky', caseName: 'flaky', retryIndex: 1, taskId: 'task-id' })
    collector.onCaseOutput({ caseId: 'flaky', content: 'try 2\n', stream: 'stdout', taskId: 'task-id' })
    collector.onTaskEnd('task-id')

    /**
     * @example
     * expect(writes).toEqual(['|project| task > flaky\n│ try 1\n│ ── retry 1/2 ──\n│ try 2\n└─ Stopped after 0ms\n'])
     */
    expect(writes).toEqual(['|project| task > flaky\n│ try 1\n│ ── retry 1/2 ──\n│ try 2\n└─ Stopped after 0ms\n'])
  })
})

/**
 * @example
 * describe('createCaseOutputReporter', () => {})
 */
describe('createCaseOutputReporter', () => {
  /**
   * @example
   * it('prints unfinished cases once even when dispose() is called twice', () => {})
   */
  it('prints unfinished cases once even when dispose() is called twice', () => {
    const writes: string[] = []
    const reporter = createCaseOutputReporter({ getNow: () => 0, write: value => writes.push(value) })

    reporter.onCaseStart({ caseId: 'busy', taskId: 'task-id' })
    reporter.onCaseOutput({ caseId: 'busy', content: 'working', stream: 'stdout', taskId: 'task-id' })
    reporter.dispose()
    reporter.dispose()

    /**
     * @example
     * expect(writes).toEqual(['task-id > busy\n│ working\n└─ Stopped after 0ms\n'])
     */
    expect(writes).toEqual(['task-id > busy\n│ working\n└─ Stopped after 0ms\n'])
  })
})

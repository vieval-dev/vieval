import { describe, expect, it } from 'vitest'

import { CaseOutputLines, createCaseOutputCollector, formatCaseOutputBlock, truncateToWidth } from './case-output'

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
 * describe('formatCaseOutputBlock', () => {})
 */
describe('formatCaseOutputBlock', () => {
  const twelveLines = Array.from({ length: 12 }, (_, index) => ({ stream: 'stdout' as const, text: `line ${index + 1}` }))

  /**
   * @example
   * it('collapses a passed case to its last 10 lines', () => {})
   */
  it('collapses a passed case to its last 10 lines', () => {
    const block = formatCaseOutputBlock({ collapse: true, colors: false, durationMs: 2_000, header: 'task > case', lines: twelveLines, state: 'passed' })

    /**
     * @example
     * expect(block.split('\n').slice(0, 3)).toEqual(['task > case', '[2 lines collapsed]', '│ line 3'])
     */
    expect(block.split('\n').slice(0, 3)).toEqual(['task > case', '[2 lines collapsed]', '│ line 3'])
    /**
     * @example
     * expect(block.endsWith('│ line 12\n└─ Done in 2 seconds\n')).toBe(true)
     */
    expect(block.endsWith('│ line 12\n└─ Done in 2 seconds\n')).toBe(true)
  })

  /**
   * @example
   * it('keeps the full output and the error message of a failed case', () => {})
   */
  it('keeps the full output and the error message of a failed case', () => {
    const block = formatCaseOutputBlock({ collapse: true, colors: false, durationMs: 500, errorMessage: 'boom', header: 'task > case', lines: twelveLines, state: 'failed' })

    /**
     * @example
     * expect(block).not.toContain('collapsed')
     */
    expect(block).not.toContain('collapsed')
    expect(block).toContain('│ line 1\n')
    /**
     * @example
     * expect(block.endsWith('└─ Failed in 500ms: boom\n')).toBe(true)
     */
    expect(block.endsWith('└─ Failed in 500ms: boom\n')).toBe(true)
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

/**
 * @example
 * describe('createCaseOutputCollector', () => {})
 */
describe('createCaseOutputCollector', () => {
  /**
   * @example
   * it('prints interleaved output of concurrent cases as one full block per case when each ends', () => {})
   */
  it('prints interleaved output of concurrent cases as one full block per case when each ends', () => {
    const writes: string[] = []
    const collector = createCaseOutputCollector({ getNow: () => 0, write: value => writes.push(value) })

    collector.onTaskQueued({ displayName: 'task', projectName: 'project', taskId: 'task-id' })
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
   * it('skips cases without output and flushes unfinished cases as stopped', () => {})
   */
  it('skips cases without output and flushes unfinished cases as stopped', () => {
    const writes: string[] = []
    const collector = createCaseOutputCollector({ getNow: () => 0, write: value => writes.push(value) })

    collector.onCaseStart({ caseId: 'quiet', caseName: 'quiet', taskId: 'task-id' })
    collector.onCaseEnd({ caseId: 'quiet', state: 'passed', taskId: 'task-id' })
    collector.onCaseStart({ caseId: 'busy', caseName: 'busy', taskId: 'task-id' })
    collector.onCaseOutput({ caseId: 'busy', content: 'working', stream: 'stdout', taskId: 'task-id' })

    /**
     * @example
     * expect(writes).toEqual([])
     */
    expect(writes).toEqual([])

    collector.flush()

    /**
     * @example
     * expect(writes).toEqual(['task-id > busy\n│ working\n└─ Stopped after 0ms\n'])
     */
    expect(writes).toEqual(['task-id > busy\n│ working\n└─ Stopped after 0ms\n'])
  })
})

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { formatResumeHint, readMeasuredCases, resolveResumedAttemptId } from './resume'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/** Writes `cases.jsonl` of one run at `<root>/<workspace>/<project>/<experiment>/<attempt>/<run>/`. */
async function writeRun(root: string, path: { attempt: string, run: string }, records: Array<{ attemptIndex?: number, caseName: string, state: string, taskId: string }>): Promise<string> {
  const runDirectory = join(root, 'workspace-a', 'project-a', 'experiment-a', path.attempt, path.run)
  await mkdir(runDirectory, { recursive: true })
  await writeFile(join(runDirectory, 'cases.jsonl'), `${records.map(record => JSON.stringify({ caseId: `0:${record.caseName}`, ...record })).join('\n')}\n`)
  return join(root, 'workspace-a', 'project-a', 'experiment-a', path.attempt)
}

describe('readMeasuredCases', () => {
  /**
   * @example
   * an auto-attempted case decides by its last round: errored then passed -> measured; passed then errored -> not.
   */
  it('keeps the cases whose last record has a result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-resume-'))
    temporaryDirectories.push(root)
    await writeRun(root, { attempt: 'attempt-1', run: 'run-1' }, [
      { attemptIndex: 0, caseName: 'recovered', state: 'errored', taskId: 'task-a' },
      { attemptIndex: 1, caseName: 'recovered', state: 'passed', taskId: 'task-a' },
      { attemptIndex: 0, caseName: 'lost', state: 'passed', taskId: 'task-a' },
      { attemptIndex: 1, caseName: 'lost', state: 'errored', taskId: 'task-a' },
      { caseName: 'wrong', state: 'failed', taskId: 'task-a' },
      { caseName: 'slow', state: 'timeout', taskId: 'task-b' },
    ])

    const measured = await readMeasuredCases({ attemptId: 'attempt-1', experimentId: 'experiment-a', projectName: 'project-a', reportRoot: root, workspaceId: 'workspace-a' })

    expect([...measured.byTask.get('task-a') ?? []].sort()).toEqual(['recovered', 'wrong'])
    expect(measured.byTask.has('task-b')).toBe(false)
  })

  /**
   * @example
   * a project that has no run in the attempt has no measured cases, so all of its cases run again.
   */
  it('treats a project without a run in the attempt as having no results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-resume-'))
    temporaryDirectories.push(root)
    await writeRun(root, { attempt: 'attempt-1', run: 'run-1' }, [{ caseName: 'a', state: 'passed', taskId: 'task-a' }])

    const measured = await readMeasuredCases({ attemptId: 'attempt-1', experimentId: 'experiment-a', projectName: 'project-b', reportRoot: root, workspaceId: 'workspace-a' })

    expect(measured.byTask.size).toBe(0)
  })
})

describe('resolveResumedAttemptId', () => {
  /**
   * @example
   * `latest` picks the attempt directory changed last, not the one whose name sorts last.
   */
  it('resolves latest by modification time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-resume-'))
    temporaryDirectories.push(root)
    const older = await writeRun(root, { attempt: 'zz-custom', run: 'run-1' }, [])
    const newer = await writeRun(root, { attempt: 'attempt-2026', run: 'run-2' }, [])
    await utimes(older, new Date('2026-10-19T08:00:00Z'), new Date('2026-10-19T08:00:00Z'))
    await utimes(newer, new Date('2026-10-19T09:00:00Z'), new Date('2026-10-19T09:00:00Z'))

    await expect(resolveResumedAttemptId({ experimentId: 'experiment-a', reportRoot: root, requested: 'latest', workspaceIds: ['workspace-a'] })).resolves.toBe('attempt-2026')
    await expect(resolveResumedAttemptId({ experimentId: 'experiment-a', reportRoot: root, requested: 'my attempt', workspaceIds: ['workspace-a'] })).resolves.toBe('my-attempt')
    await expect(resolveResumedAttemptId({ experimentId: 'other', reportRoot: root, requested: 'latest', workspaceIds: ['workspace-a'] })).rejects.toThrow('found no attempt')
  })
})

describe('formatResumeHint', () => {
  const base = {
    attemptId: 'attempt-2026-10-19T08-12-03-551Z',
    cwd: '/repo',
    noResult: { errored: 0, timeout: 0 },
    reportEnabled: true,
    selection: { case: [], project: [], task: [], workspace: [] },
  }

  /**
   * @example
   * only wrong answers -> no hint: a failed case is a result.
   */
  it('stays quiet when every case has a result', () => {
    expect(formatResumeHint(base)).toBeUndefined()
  })

  /**
   * @example
   * one errored case -> "1 case has no result".
   */
  it('counts a single case in the singular', () => {
    expect(formatResumeHint({ ...base, noResult: { errored: 1, timeout: 0 } })).toContain('1 case has no result (1 errored).')
  })

  /**
   * @example
   * 95 errored, 7 timed out -> the counts and a command that resumes this attempt by id.
   */
  it('suggests resuming the attempt by id, repeating the selectors of the run', () => {
    const hint = formatResumeHint({
      ...base,
      noResult: { errored: 95, timeout: 7 },
      selection: { case: ['case #1'], configFilePath: '/repo/evals/tts/vieval.config.ts', project: [], task: ['ko'], workspace: ['llm'] },
    })

    expect(hint).toBe([
      '102 cases have no result (95 errored, 7 timed out). Resume them with:',
      '',
      '  vieval run --config ./evals/tts/vieval.config.ts --workspace llm --task ko --case \'case #1\' --resume attempt-2026-10-19T08-12-03-551Z',
    ].join('\n'))
  })

  /**
   * @example
   * Ctrl+C -> a hint even without errored cases, because cases that did not start have no result.
   */
  it('suggests resuming an interrupted run', () => {
    expect(formatResumeHint({ ...base, interruptSignal: 'SIGINT' })).toContain('Interrupted by SIGINT; the cases that did not start have no result either. Resume them with:')
  })

  /**
   * @example
   * a comparison where one workspace crashed -> a hint that names the workspace count.
   */
  it('counts workspaces that did not finish', () => {
    expect(formatResumeHint({ ...base, unfinishedWorkspaces: 1 })).toContain('Some cases have no result (1 workspace did not finish).')
  })

  /**
   * @example
   * --no-report -> no command, because there is nothing to resume from.
   */
  it('explains that a run without reports cannot be resumed', () => {
    const hint = formatResumeHint({ ...base, noResult: { errored: 2, timeout: 0 }, reportEnabled: false })

    expect(hint).toContain('cannot be resumed')
    expect(hint).not.toContain('--resume')
  })
})

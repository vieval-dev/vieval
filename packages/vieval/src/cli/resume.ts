import type { CaseRecord } from './report-records'

import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { glob } from 'tinyglobby'

import { isMeasuredState } from '../core/scoring'
import { sanitizeIdentitySegment } from './report-artifacts'
import { readCaseRecordFile } from './report-records'

/** `--resume` value that picks the most recent attempt of the experiment. */
export const LATEST_ATTEMPT = 'latest'

/**
 * Cases of an earlier attempt that already have a result, by task.
 *
 * Resuming runs every other case: the ones that errored, timed out, or never ran because the attempt was interrupted.
 */
export interface MeasuredCases {
  /** The attempt being resumed. */
  attemptId: string
  /** Names of the cases with a result (`passed` or `failed`), keyed by task id. */
  byTask: ReadonlyMap<string, ReadonlySet<string>>
}

/**
 * What a finished or interrupted invocation needs to suggest the command that resumes it.
 */
export interface ResumeHintInput {
  /** Attempt of the invocation that just ended. */
  attemptId: string
  /** Directory the command is copied into, to make the config path relative. */
  cwd: string
  /** Signal that interrupted the invocation, if any; cases that never started then have no result either. */
  interruptSignal?: string
  /** Cases that ended without a result. */
  noResult: { errored: number, timeout: number }
  /** Whether reports were written; without them nothing can be resumed. */
  reportEnabled: boolean
  /**
   * The selectors of the invocation, repeated so the resumed run covers the same work. Without them, cases the
   * invocation never selected would count as "no result" and run too.
   */
  selection: {
    case: readonly string[]
    configFilePath?: string
    experiment?: string
    project: readonly string[]
    task: readonly string[]
    workspace: readonly string[]
  }
  /** Workspaces of a comparison that ended without output (crashed); their cases have no result. */
  unfinishedWorkspaces?: number
}

/**
 * Formats the hint printed after an invocation that left cases without a result, with a command to copy.
 *
 * Use when:
 * - `vieval run` ended interrupted, with errored or timed-out cases, or with workspaces that crashed
 *
 * Expects:
 * - `selection` to be the arguments the user passed, not resolved defaults, so the command stays short
 *
 * Returns:
 * - the hint text, or `undefined` when every case has a result (failed cases are results)
 */
export function formatResumeHint(input: ResumeHintInput): string | undefined {
  const { errored, timeout } = input.noResult
  const unfinishedWorkspaces = input.unfinishedWorkspaces ?? 0
  if (input.interruptSignal == null && errored + timeout === 0 && unfinishedWorkspaces === 0) {
    return undefined
  }

  const reasons = [
    ...(errored > 0 ? [`${errored} errored`] : []),
    ...(timeout > 0 ? [`${timeout} timed out`] : []),
    ...(unfinishedWorkspaces > 0 ? [`${unfinishedWorkspaces} workspace${unfinishedWorkspaces === 1 ? '' : 's'} did not finish`] : []),
  ]
  const headline = input.interruptSignal == null
    ? `${noResultCount(errored + timeout)} (${reasons.join(', ')}).`
    : `Interrupted by ${input.interruptSignal}${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''}; the cases that did not start have no result either.`

  if (!input.reportEnabled) {
    return `${headline}\nThis run wrote no reports (--no-report), so it cannot be resumed.`
  }

  const { selection } = input
  const command = [
    'vieval',
    'run',
    ...(selection.configFilePath == null ? [] : ['--config', toCommandPath(selection.configFilePath, input.cwd)]),
    ...(selection.experiment == null ? [] : ['--experiment', selection.experiment]),
    ...selection.workspace.flatMap(value => ['--workspace', value]),
    ...selection.project.flatMap(value => ['--project', value]),
    ...selection.task.flatMap(value => ['--task', value]),
    ...selection.case.flatMap(value => ['--case', value]),
    '--resume',
    input.attemptId,
  ].map(quoteShellArgument).join(' ')

  return `${headline} Resume them with:\n\n  ${command}`
}

/**
 * Reads which cases of one project already have a result in an earlier attempt.
 *
 * Use when:
 * - resuming an attempt decides which cases of a project to run again
 *
 * Expects:
 * - the attempt to exist for this workspace; a project without a run in it has no measured cases, so all of its
 *   cases run
 *
 * Returns:
 * - case names with a result in their last record (the highest auto attempt), by task id
 *
 * Throws:
 * - when the workspace has no such attempt, or a `cases.jsonl` line is not JSON or was written by an older vieval
 */
export async function readMeasuredCases(options: {
  attemptId: string
  experimentId: string
  projectName: string
  reportRoot: string
  workspaceId: string
}): Promise<MeasuredCases> {
  const workspaceDirectory = resolve(options.reportRoot, options.workspaceId)
  const workspaceAttempts = await glob(`*/${options.experimentId}/${options.attemptId}`, { cwd: workspaceDirectory, onlyDirectories: true })
  if (workspaceAttempts.length === 0) {
    throw new Error(`--resume: workspace "${options.workspaceId}" has no attempt "${options.attemptId}" of experiment "${options.experimentId}" under "${options.reportRoot}".`)
  }

  const attemptDirectory = join(workspaceDirectory, sanitizeIdentitySegment(options.projectName), options.experimentId, options.attemptId)
  const caseFiles = existsSync(attemptDirectory)
    ? await glob('*/cases.jsonl', { absolute: true, cwd: attemptDirectory })
    : []

  // Keyed by task and case id: the last record of an auto-attempted case decides whether it has a result.
  const lastRecords = new Map<string, CaseRecord>()
  for (const caseFile of caseFiles) {
    for (const record of readCaseRecordFile(caseFile)) {
      const key = `${record.taskId}\u0000${record.caseId}`
      const previous = lastRecords.get(key)
      if (previous == null || (record.attemptIndex ?? 0) >= (previous.attemptIndex ?? 0)) {
        lastRecords.set(key, record)
      }
    }
  }

  const byTask = new Map<string, Set<string>>()
  for (const record of lastRecords.values()) {
    if (!isMeasuredState(record.state)) {
      continue
    }
    const names = byTask.get(record.taskId) ?? new Set<string>()
    names.add(record.caseName)
    byTask.set(record.taskId, names)
  }

  return { attemptId: options.attemptId, byTask }
}

/**
 * Resolves the attempt that `--resume` continues.
 *
 * Use when:
 * - `vieval run --resume <attemptId|latest>` starts, before its own attempt directory exists
 *
 * Expects:
 * - `workspaceIds` to list the workspaces whose attempts count; a comparison passes all of its workspaces, so every
 *   workspace process retries the same attempt
 *
 * Returns:
 * - the given attempt id, or for `latest` the attempt directory of the experiment that changed last
 *
 * Throws:
 * - when `latest` finds no attempt of the experiment
 */
export async function resolveResumedAttemptId(options: {
  experimentId: string
  reportRoot: string
  requested: string
  workspaceIds: readonly string[]
}): Promise<string> {
  if (options.requested !== LATEST_ATTEMPT) {
    return sanitizeIdentitySegment(options.requested)
  }

  // `<reportRoot>/<workspace>/<project>/<experiment>/<attempt>`; custom attempt ids do not sort by time, so the
  // directory's modification time decides. Identity segments are sanitized to `[\w.-]`, so they are literal globs.
  const attemptDirectories = await glob(options.workspaceIds.map(workspaceId => `${workspaceId}/*/${options.experimentId}/*`), {
    absolute: true,
    cwd: options.reportRoot,
    onlyDirectories: true,
  })
  const attempts = await Promise.all(attemptDirectories.map(async directory => ({
    attemptId: directory.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1)!,
    modifiedAt: (await stat(directory)).mtimeMs,
  })))
  const latest = attempts.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]
  if (latest == null) {
    throw new Error(`--resume latest found no attempt of experiment "${options.experimentId}" under "${options.reportRoot}".`)
  }

  return latest.attemptId
}

function noResultCount(count: number): string {
  if (count === 0) {
    return 'Some cases have no result'
  }
  return count === 1 ? '1 case has no result' : `${count} cases have no result`
}

/**
 * Quotes one argument for POSIX shells when it contains anything but safe characters.
 *
 * Before:
 * - "--case", "case #1", "it's"
 *
 * After:
 * - "--case", "'case #1'", "'it'\\''s'"
 */
function quoteShellArgument(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * Makes a config path relative to where the command is pasted, keeping a leading `./` so it reads as a path.
 *
 * Before:
 * - "/repo/evals/tts/vieval.config.ts" from "/repo"
 * - "/elsewhere/vieval.config.ts" from "/repo"
 *
 * After:
 * - "./evals/tts/vieval.config.ts"
 * - "../elsewhere/vieval.config.ts"
 */
function toCommandPath(filePath: string, cwd: string): string {
  const path = relative(cwd, resolve(cwd, filePath))
  if (isAbsolute(path)) {
    return path
  }
  return path.startsWith('..') ? path : `./${path}`
}

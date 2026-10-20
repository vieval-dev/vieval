/**
 * HTTP contract of the vieval viewer API.
 *
 * Every response body of `/api/*` is described here as a Valibot schema, and the TypeScript types are inferred
 * from the schemas. The contract tests validate real responses against these schemas, so the schemas and
 * `API.md` are the source of truth for clients (the viewer frontend included).
 *
 * Naming:
 * - `attemptId` is the run-level attempt label (`--attempt`, report path segment). It never re-runs anything.
 * - `roundIndex` is the auto attempt of a task (`autoAttempt`, a full re-run of every case of the task).
 *   It equals the scheduler's `attemptIndex`; `roundIndexInferred` is `true` when the event log does not carry
 *   `attemptIndex` and the round was derived from the order of `case.started` events.
 * - `retryIndex` is an immediate retry of one case inside one round (`autoRetry`).
 */

import { graderSchema, localizedTextSchema, metricDefinedDataSchema, scoreDefinedDataSchema, scoreRecordedDataSchema } from 'vieval/events'

import * as v from 'valibot'

/** Version of this contract, reported by `GET /api/health`. */
export const VIEWER_API_VERSION = 1

const nullableNumber = v.nullable(v.number())

// ---------------------------------------------------------------------------------------------------------------
// Scores (the shapes of `vieval/core/scoring`)
// ---------------------------------------------------------------------------------------------------------------

/** One named value over a group of cases (`ScoreSummary` of `vieval/core/scoring`). */
export const scoreSummarySchema = v.object({
  /** `sum / n`, or `null` when no case counted. */
  mean: nullableNumber,
  /** Cases that counted toward `mean`. */
  n: v.number(),
  /** Score name; `completion` and `passed` for the built-in summaries. */
  name: v.string(),
  sum: v.number(),
  /** Settled cases that were not skipped. */
  total: v.number(),
  /** Cases that did not count, per reason (unscored reasons; `errored` / `timeout` for `completion`). */
  unscored: v.record(v.string(), v.number()),
})

/** Scores of one group of cases, for example one task (`CaseScoring` of `vieval/core/scoring`). */
export const caseScoringSchema = v.object({
  completion: scoreSummarySchema,
  passed: scoreSummarySchema,
  /** Name of the headline score of the group, when it has one. */
  primary: v.optional(v.string()),
  scores: v.array(scoreSummarySchema),
})

/** Resolved headline and completion rate (`HeadlineResult` of `vieval/core/scoring`). */
export const headlineResultSchema = v.object({
  completion: scoreSummarySchema,
  headline: v.variant('kind', [
    v.object({ kind: v.literal('score'), score: scoreSummarySchema }),
    v.object({ kind: v.literal('passed-cases'), score: scoreSummarySchema }),
    v.object({ kind: v.literal('per-task'), tasks: v.array(v.object({ score: scoreSummarySchema, taskId: v.string() })) }),
  ]),
})

/**
 * Graders that produced each score of a group of cases, by score name: every distinct kind, model, and version seen in
 * the score records (a record's own grader, else the definition's). Two groups whose graders of one score differ do
 * not measure the same thing.
 */
export const scoreGradersSchema = v.record(v.string(), v.array(graderSchema))

/** Score values of one case round: recorded or derived values, and unscored records with their reason. */
export const caseScoresSchema = v.object({
  unscored: v.record(v.string(), v.string()),
  values: v.record(v.string(), v.number()),
})

// ---------------------------------------------------------------------------------------------------------------
// Runs and the report hierarchy
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where the data of a run comes from.
 *
 * - `live-bus`: a run of this process (`vieval run --with-viewer`), fed by its in-process event bus.
 * - `live-tail`: a run written by another process; its `events.jsonl` is tailed incrementally.
 * - `offline`: a finished run read from its report directory.
 * - `unsupported`: a report written by an older vieval (event schema version below 3). It is listed, but its events are not
 *   read and every route that opens it answers 422 ("This report was written by an older vieval. Run it again.").
 */
export const runSourceSchema = v.picklist(['live-bus', 'live-tail', 'offline', 'unsupported'])

/**
 * Run state.
 *
 * `stale` means: no terminal event, and the last event is older than the stale threshold (the writer probably
 * died). It is shown, not guessed as failed. `unsupported` is the state of an `unsupported` source: a run that cannot be read.
 */
export const runStateSchema = v.picklist(['running', 'stale', 'ended', 'interrupted', 'unsupported'])

export const runIdentitySchema = v.object({
  attemptId: v.string(),
  experimentId: v.string(),
  runId: v.string(),
  workspaceId: v.string(),
})

export const caseCountsSchema = v.object({
  /** Cases that ended without a result: they threw something other than an assertion. */
  errored: v.number(),
  /** Cases with a failed assertion: a wrong result. */
  failed: v.number(),
  passed: v.number(),
  /** Cases waiting at the end of the queue to run again; they have not ended. */
  requeued: v.number(),
  running: v.number(),
  skipped: v.number(),
  timeout: v.number(),
  total: v.number(),
})

export const runListItemSchema = v.object({
  ...runIdentitySchema.entries,
  /**
   * Cases the run is expected to settle: known task totals, with the tasks that did not start yet extrapolated (see
   * `RunProgress.cases.estimatedTotal`). `undefined` until a case started. Larger than `counts.total` when the run was
   * interrupted or re-ran only some cases.
   */
  caseTotal: v.optional(v.number()),
  counts: caseCountsSchema,
  endedAt: v.optional(v.string()),
  /** Eval-matrix axes of the run's tasks and their distinct values, sorted, like `matrix` for the run matrix. */
  evalMatrix: v.record(v.string(), v.array(v.string())),
  /** Headline of the run: from `run-summary.json` when written, else from its events. `null` before any case settled. */
  headline: v.nullable(headlineResultSchema),
  /** Latest `score.defined` of each score in `headline`, for its label and description. */
  headlineDefinitions: v.array(scoreDefinedDataSchema),
  lastEventAt: v.optional(v.string()),
  lastSeq: v.number(),
  /**
   * Run-matrix axes of the run's tasks and their distinct values, sorted (for example `{ model: ['gpt-5.5'],
   * repeat: ['1', '2', '3'] }`). Empty for runs without a run matrix. Clients build readable experiment labels from it
   * instead of parsing the experiment id.
   */
  matrix: v.record(v.string(), v.array(v.string())),
  /** Project ids seen in the run's events (or summary). */
  projectIds: v.array(v.string()),
  /** Project segment of the report path (`multi-project` when one run executed several projects). */
  projectSegment: v.string(),
  /** Report directory relative to its report root, `null` for runs without a report. */
  reportPath: v.nullable(v.string()),
  /** Absolute report root the run was found in (one of `--report-root`s, for example an archive), `null` without a report. */
  reportRoot: v.nullable(v.string()),
  /** Stable key of the run in this API. Equals `runId`. */
  runKey: v.string(),
  source: runSourceSchema,
  startedAt: v.optional(v.string()),
  state: runStateSchema,
})

export const treeResponseSchema = v.object({
  reportRoots: v.array(v.string()),
  workspaces: v.array(v.object({
    id: v.string(),
    projects: v.array(v.object({
      experiments: v.array(v.object({
        attempts: v.array(v.object({
          id: v.string(),
          runs: v.array(runListItemSchema),
        })),
        id: v.string(),
      })),
      id: v.string(),
    })),
  })),
})

// ---------------------------------------------------------------------------------------------------------------
// Execution tree: run → project → task → round → case → try
// ---------------------------------------------------------------------------------------------------------------

/** `requeued`: the case ran without a result and waits at the end of the queue to run again; it has not ended. */
export const caseStateSchema = v.picklist(['running', 'requeued', 'passed', 'failed', 'errored', 'skipped', 'timeout', 'unfinished'])

export const tryNodeSchema = v.object({
  autoRetry: v.number(),
  endedAt: v.optional(v.string()),
  /** Why a `requeued` try went back to the queue. */
  errorMessage: v.optional(v.string()),
  /** Number of requeues before this try; `0` before the first requeue. */
  requeueIndex: v.number(),
  /** Retried tries end when the next try starts. */
  retryIndex: v.number(),
  startedAt: v.string(),
  /** `retried`: this try failed and the case was retried at once. `requeued`: it failed and the case was requeued. */
  state: v.union([caseStateSchema, v.literal('retried')]),
})

export const caseRoundSchema = v.object({
  endedAt: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  /** `name` of the thrown error (`AssertionError`, `APICallError`, …), for grouping failures. */
  errorName: v.optional(v.string()),
  /** Most times the case may be requeued, when the task requeues. */
  requeue: v.optional(v.number()),
  /** When the round was last requeued, while it is `requeued`. */
  requeuedAt: v.optional(v.string()),
  /** Least wait in ms after the last requeue, while the round is `requeued`. */
  requeueDelayMs: v.optional(v.number()),
  roundIndex: v.number(),
  roundIndexInferred: v.boolean(),
  /** Scores of the round's last try: recorded with `recordScore` / `recordUnscored`, or derived. */
  scores: caseScoresSchema,
  startedAt: v.string(),
  state: caseStateSchema,
  tries: v.array(tryNodeSchema),
})

export const caseNodeSchema = v.object({
  artifactCount: v.number(),
  caseId: v.string(),
  durationMs: v.optional(v.number()),
  endedAt: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  /** `name` of the error that ended the last round, for grouping failures. */
  errorName: v.optional(v.string()),
  evidenceLinkCount: v.number(),
  /**
   * Identity of the case across runs, as `vieval report compare` aligns cases: the `benchmark.case.id` metric, else the
   * `vieval.case.id` metric, else the case name (`caseId` carries the index, which differs when a run lists other cases).
   */
  identity: v.string(),
  index: v.number(),
  /** `taskId + '\u0000' + caseId`, the same key `cases.jsonl` tooling uses. */
  key: v.string(),
  logLineCount: v.number(),
  metricCount: v.number(),
  name: v.string(),
  projectId: v.optional(v.string()),
  rounds: v.array(caseRoundSchema),
  /** Scores of the last round. */
  scores: caseScoresSchema,
  startedAt: v.string(),
  /** State of the last round (the final state). */
  state: caseStateSchema,
  taskId: v.string(),
})

export const taskStateSchema = v.picklist(['queued', 'running', 'passed', 'failed', 'skipped', 'unfinished'])

export const taskMatrixSchema = v.object({
  eval: v.record(v.string(), v.string()),
  evalRowId: v.string(),
  run: v.record(v.string(), v.string()),
  runRowId: v.string(),
})

export const taskNodeSchema = v.object({
  /** Highest `autoAttempt` seen on the task's cases, when the log carries it. */
  autoAttemptMax: v.optional(v.number()),
  caseCounts: caseCountsSchema,
  cases: v.array(caseNodeSchema),
  /** `case.started.total` of the task; unknown until its first case started. */
  caseTotal: v.optional(v.number()),
  displayName: v.string(),
  endedAt: v.optional(v.string()),
  /** Parsed from the task id (`<entryId>::<inferenceExecutorId>::run=<row>::eval=<row>`). */
  entryId: v.optional(v.string()),
  id: v.string(),
  inferenceExecutorId: v.optional(v.string()),
  matrix: v.optional(taskMatrixSchema),
  projectId: v.string(),
  roundCount: v.number(),
  /** Graders that produced each score of the task. */
  scoreGraders: scoreGradersSchema,
  /** Scores of the task over every round's case outcome (`scoreCases`, the rule of `describeTask`). */
  scoring: caseScoringSchema,
  startedAt: v.optional(v.string()),
  state: taskStateSchema,
})

export const projectNodeSchema = v.object({
  endedAt: v.optional(v.string()),
  failed: v.optional(v.boolean()),
  id: v.string(),
  startedAt: v.optional(v.string()),
  state: v.picklist(['queued', 'running', 'ended']),
  taskCount: v.optional(v.number()),
  taskIds: v.array(v.string()),
})

export const runProgressSchema = v.object({
  /** `cases`: every task's case total is known; `cases+task-extrapolation`: unknown totals extrapolated. */
  basis: v.picklist(['cases', 'cases+task-extrapolation', 'unknown', 'ended']),
  cases: v.object({
    completed: v.number(),
    estimatedTotal: v.optional(v.number()),
    knownTotal: v.number(),
    running: v.number(),
    /** Cases waiting at the end of the queue to run again: neither running nor completed. */
    waiting: v.number(),
  }),
  elapsedMs: v.number(),
  estimatedTotalMs: v.optional(v.number()),
  etaMs: v.optional(v.number()),
  /**
   * Completed cases over time: one point per settled round, cumulative, downsampled to at most 240 points (the first
   * and the last point are always kept). `elapsedMs` is measured from `run.started`. Feeds the progress chart, whose
   * projection runs from the last point to `estimatedTotalMs` / `cases.estimatedTotal`.
   */
  history: v.array(v.object({
    completed: v.number(),
    elapsedMs: v.number(),
  })),
  /** `true` once an auto attempt round > 0 was seen: more rounds may follow, the ETA is a lower bound. */
  lowerBound: v.boolean(),
  /** completed / estimatedTotal, from 0 to 1. */
  ratio: v.optional(v.number()),
  tasks: v.object({
    completed: v.number(),
    total: v.number(),
  }),
})

export const currentPositionSchema = v.object({
  lastEvent: v.optional(v.object({
    event: v.string(),
    seq: v.number(),
    time: v.string(),
  })),
  running: v.array(v.object({
    caseId: v.string(),
    elapsedMs: v.number(),
    name: v.string(),
    projectId: v.optional(v.string()),
    retryIndex: v.number(),
    roundIndex: v.number(),
    startedAt: v.string(),
    taskDisplayName: v.string(),
    taskId: v.string(),
  })),
  /** Cases waiting at the end of the queue to run again, oldest requeue first. */
  waiting: v.array(v.object({
    caseId: v.string(),
    delayMs: v.number(),
    name: v.string(),
    projectId: v.optional(v.string()),
    requeue: v.number(),
    requeuedAt: v.string(),
    /** Requeues so far, including this one. */
    requeueIndex: v.number(),
    taskDisplayName: v.string(),
    taskId: v.string(),
  })),
})

export const runSnapshotSchema = v.object({
  current: currentPositionSchema,
  endedAt: v.optional(v.string()),
  eventCounts: v.record(v.string(), v.number()),
  /** Headline of the run from its events (`resolveHeadline` over the tasks), `null` before any case settled. */
  headline: v.nullable(headlineResultSchema),
  identity: runIdentitySchema,
  interruptSignal: v.optional(v.string()),
  /** Lines of `events.jsonl` that were not valid envelopes (live tail only). */
  parseErrors: v.number(),
  progress: runProgressSchema,
  projects: v.array(projectNodeSchema),
  runKey: v.string(),
  /** Latest `score.defined` of each score of the run. */
  scoreDefinitions: v.array(scoreDefinedDataSchema),
  /** Highest applied `seq`. Subscribe to the stream with `?after=<seq>` to continue from this snapshot. */
  seq: v.number(),
  /** Missing `seq` numbers seen while reading; duplicates are dropped silently. */
  seqGaps: v.number(),
  source: runSourceSchema,
  startedAt: v.optional(v.string()),
  state: runStateSchema,
  /** Official summary written after the run (`run-summary.json`), when present. */
  summary: v.optional(v.object({
    caseSummary: v.optional(caseCountsSchema),
    headline: v.optional(headlineResultSchema),
  })),
  tasks: v.array(taskNodeSchema),
})

export const progressResponseSchema = v.object({
  current: currentPositionSchema,
  progress: runProgressSchema,
  runKey: v.string(),
  seq: v.number(),
  state: runStateSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// Events, case detail, timeline, logs, metrics, scores
// ---------------------------------------------------------------------------------------------------------------

export const runEventSchema = v.object({
  attemptId: v.string(),
  caseId: v.optional(v.string()),
  data: v.unknown(),
  event: v.string(),
  experimentId: v.string(),
  projectId: v.optional(v.string()),
  runId: v.string(),
  schemaVersion: v.number(),
  seq: v.number(),
  taskId: v.optional(v.string()),
  time: v.string(),
  workspaceId: v.string(),
})

export const eventsResponseSchema = v.object({
  events: v.array(runEventSchema),
  /** Pass as `after` to read the next page; equals the last returned `seq`. */
  nextAfter: v.number(),
  seq: v.number(),
})

export const metricEntrySchema = v.object({
  caseId: v.optional(v.string()),
  name: v.string(),
  roundIndex: v.optional(v.number()),
  seq: v.number(),
  taskId: v.optional(v.string()),
  time: v.string(),
  value: v.unknown(),
})

export const artifactDescriptorSchema = v.object({
  caseId: v.optional(v.string()),
  contentType: v.string(),
  /** What the file shows, from `recordArtifact(…, { description })`. */
  description: v.optional(localizedTextSchema),
  /** Human-readable name shown instead of `name`, from `recordArtifact(…, { label })`. */
  label: v.optional(localizedTextSchema),
  name: v.string(),
  /** Path relative to the run's artifacts root; pass it to `/artifacts/raw?path=`. */
  path: v.string(),
  previewKind: v.picklist(['image', 'video', 'audio', 'jsonl', 'json', 'yaml', 'toml', 'text', 'html', 'binary']),
  purpose: v.optional(v.string()),
  roundIndex: v.optional(v.number()),
  size: v.number(),
  /** `event`: announced by `artifact.recorded`; `directory`: found in `artifacts/<task>/<case>/` only. */
  source: v.picklist(['event', 'directory']),
  taskId: v.optional(v.string()),
})

export const evidenceLinkSchema = v.object({
  adapter: v.picklist(['osworld', 'generic']),
  /** `false` when the path is outside the allowed evidence roots or missing; nothing is served then. */
  allowed: v.boolean(),
  caseId: v.string(),
  exists: v.boolean(),
  /** Stable id of the link inside the run; use it in `/evidence/:linkId/*`. */
  id: v.string(),
  kind: v.picklist(['directory', 'file', 'missing']),
  metricName: v.string(),
  /** The path as recorded. */
  path: v.string(),
  reason: v.optional(v.string()),
  roundIndex: v.optional(v.number()),
  /** Adapter summary; for OSWorld the fields of `result.json`. */
  summary: v.optional(v.record(v.string(), v.unknown())),
  taskId: v.string(),
})

export const caseDetailSchema = v.object({
  ...caseNodeSchema.entries,
  artifacts: v.array(artifactDescriptorSchema),
  evidence: v.array(evidenceLinkSchema),
  inference: v.array(v.object({
    data: v.unknown(),
    event: v.string(),
    roundIndex: v.optional(v.number()),
    seq: v.number(),
    time: v.string(),
  })),
  input: v.optional(v.unknown()),
  /** Latest `metric.defined` of each metric this case recorded (label, description, unit, direction). */
  metricDefinitions: v.array(metricDefinedDataSchema),
  metrics: v.array(metricEntrySchema),
  output: v.optional(v.unknown()),
  /** Latest `score.defined` of each score of the case's task (label, description, combination, grader). */
  scoreDefinitions: v.array(scoreDefinedDataSchema),
  /** Every `score.recorded` of the case, with its rationale, grader, and metadata, in event order. */
  scoreRecords: v.array(v.object({
    record: scoreRecordedDataSchema,
    roundIndex: v.optional(v.number()),
    seq: v.number(),
  })),
  taskDisplayName: v.string(),
})

export const timelineEntrySchema = v.object({
  caseId: v.string(),
  durationMs: v.optional(v.number()),
  endedAt: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  name: v.string(),
  requeueIndex: v.number(),
  retryIndex: v.number(),
  roundIndex: v.number(),
  roundIndexInferred: v.boolean(),
  startedAt: v.string(),
  state: v.union([caseStateSchema, v.literal('retried')]),
  taskId: v.string(),
})

export const timelineResponseSchema = v.object({
  entries: v.array(timelineEntrySchema),
  /** Rounds per task: `[{taskId, rounds: [{roundIndex, startedAt, endedAt, passed, failed, errored}]}]`. */
  rounds: v.array(v.object({
    rounds: v.array(v.object({
      endedAt: v.optional(v.string()),
      /** Cases of the round without a result: errored, timed out, skipped, or unfinished. */
      errored: v.number(),
      failed: v.number(),
      passed: v.number(),
      roundIndex: v.number(),
      running: v.number(),
      startedAt: v.string(),
    })),
    taskId: v.string(),
  })),
})

export const logLineSchema = v.object({
  caseId: v.optional(v.string()),
  roundIndex: v.optional(v.number()),
  seq: v.number(),
  stream: v.picklist(['stdout', 'stderr']),
  taskId: v.optional(v.string()),
  text: v.string(),
  time: v.string(),
})

export const logsResponseSchema = v.object({
  lines: v.array(logLineSchema),
  /** Pass as `offset` for the next page. `null` when there is no more data yet. */
  nextOffset: v.nullable(v.number()),
  total: v.number(),
})

export const metricsResponseSchema = v.object({
  /** Latest `metric.defined` of each metric in this response (label, description, unit, direction). */
  definitions: v.array(metricDefinedDataSchema),
  inference: v.object({
    failed: v.number(),
    requests: v.number(),
    responses: v.number(),
    totals: v.record(v.string(), v.number()),
  }),
  nonNumeric: v.array(v.object({
    name: v.string(),
    values: v.array(metricEntrySchema),
  })),
  numeric: v.array(v.object({
    name: v.string(),
    points: v.array(metricEntrySchema),
    summary: v.object({
      avg: v.number(),
      count: v.number(),
      max: v.number(),
      min: v.number(),
      sum: v.number(),
    }),
  })),
  /** Latest `score.defined` of each score in `scores`. */
  scoreDefinitions: v.array(scoreDefinedDataSchema),
  /** Scores beside the metrics: each case's counted value (the last round), with the summary of the selection. */
  scores: v.array(v.object({
    name: v.string(),
    points: v.array(v.object({ caseId: v.string(), roundIndex: v.optional(v.number()), taskId: v.string(), value: v.number() })),
    summary: scoreSummarySchema,
  })),
})

export const scoresResponseSchema = v.object({
  byRound: v.array(v.object({
    roundIndex: v.number(),
    scoring: caseScoringSchema,
    taskId: v.string(),
  })),
  byTask: v.array(v.object({
    displayName: v.string(),
    matrix: v.optional(taskMatrixSchema),
    scoring: caseScoringSchema,
    taskId: v.string(),
  })),
  cases: v.array(v.object({
    caseId: v.string(),
    name: v.string(),
    scores: caseScoresSchema,
    state: caseStateSchema,
    taskId: v.string(),
  })),
  /** Latest `score.defined` of each score of the run. */
  definitions: v.array(scoreDefinedDataSchema),
  /** From the run's events (all rounds, `describeTask` rule): the headline, and each score pooled over the tasks. */
  overall: v.object({
    headline: v.nullable(headlineResultSchema),
    scores: v.array(scoreSummarySchema),
  }),
  /** From `run-summary.json`, once written. */
  summary: v.optional(headlineResultSchema),
})

// ---------------------------------------------------------------------------------------------------------------
// Files: artifacts and evidence
// ---------------------------------------------------------------------------------------------------------------

export const fileEntrySchema = v.object({
  contentType: v.string(),
  kind: v.picklist(['file', 'directory']),
  /** Path relative to the listed root, with `/` separators. */
  path: v.string(),
  previewKind: v.optional(artifactDescriptorSchema.entries.previewKind),
  size: v.number(),
})

export const fileTreeResponseSchema = v.object({
  entries: v.array(fileEntrySchema),
  /** `true` when the listing stopped at the entry limit. */
  truncated: v.boolean(),
})

export const jsonlPageSchema = v.object({
  limit: v.number(),
  offset: v.number(),
  /** `true` when the file was still growing past the last complete line. */
  partialTail: v.boolean(),
  /** Parsed rows; a line that is not JSON is returned as `{ "$raw": "<line>", "$error": "<message>" }`. */
  rows: v.array(v.unknown()),
  /** Complete lines in the file at the time of reading. */
  totalLines: v.number(),
})

/**
 * Placeholder data of one image file: its size and a ThumbHash, so a client can reserve the image's box and paint a
 * blurred preview before the file itself loads.
 *
 * Returned by `GET /api/runs/:runKey/artifacts/preview?path=` and `GET /api/runs/:runKey/evidence/:linkId/preview?path=`.
 */
export const imagePreviewSchema = v.object({
  /** Height of the original image in pixels. */
  height: v.number(),
  /** ThumbHash (https://evanw.github.io/thumbhash/) of the image, base64-encoded. */
  thumbhash: v.string(),
  /** Width of the original image in pixels. */
  width: v.number(),
})

/**
 * How much of a matrix cell one run measured. Cases are told apart by `CaseNode.identity`.
 *
 * - `full`: every expected case of the task settled and at least one has a result (cases without a result are counted
 *   in `counts.errored`, they do not make the run partial), over the same cases as the cell's headline run
 * - `other`: every case the run planned settled, but over other cases than the headline run: a smoke or limited run
 *   of some of its cases, or another case set (a second dataset under the same entry); its score is not comparable
 * - `partial`: some expected cases never ran or never settled (an interrupted run, a re-run of a few cases, a running
 *   task)
 * - `none`: no case has a result (every case errored, or none ran)
 */
export const cellCoverageSchema = v.picklist(['full', 'other', 'partial', 'none'])

/**
 * One cell of the matrix overview: one eval entry × run-matrix row × eval-matrix row, across the runs in scope.
 */
export const matrixCellSchema = v.object({
  /**
   * Cases of the cell's headline run: the newest run that settled every case it planned, over cases that no other run
   * of the cell covers a strict superset of. Expected cases of the newest run when no run settled every case.
   */
  caseCount: v.number(),
  /** Eval entry id parsed from the task id (`evals%2Fosworld%2F…`); one entry is one table in the UI. */
  entryId: v.string(),
  eval: v.record(v.string(), v.string()),
  evalRowId: v.string(),
  /** Every run that executed this cell, oldest first (one point per run for the cell's sparkline). */
  history: v.array(v.object({
    attemptId: v.string(),
    /** Completion rate of the run's task. */
    completion: nullableNumber,
    counts: caseCountsSchema,
    coverage: cellCoverageSchema,
    runKey: v.string(),
    /** Mean of the cell's primary score in this run, or `null`. */
    score: nullableNumber,
    startedAt: v.optional(v.string()),
    state: v.string(),
  })),
  /**
   * Result of the run the cell shows: the newest run that covered the cell fully or is still running it; the newest
   * run when none did. A partial re-run or a run over other cases therefore never replaces a full run as the headline.
   */
  latest: v.object({
    attemptId: v.string(),
    /** Primary score of every case of the run (`null`: no value), for the spread of the score under the mean. */
    caseScores: v.array(nullableNumber),
    /** Expected cases of the task (`case.started.total`); `undefined` until its first case started. */
    caseTotal: v.optional(v.number()),
    counts: caseCountsSchema,
    coverage: cellCoverageSchema,
    experimentId: v.string(),
    runKey: v.string(),
    /** Scores of the task in this run. */
    scoring: caseScoringSchema,
    startedAt: v.optional(v.string()),
    /** Task state (see `TaskNode.state`). */
    state: v.string(),
    taskId: v.string(),
  }),
  run: v.record(v.string(), v.string()),
  runRowId: v.string(),
  /**
   * Whether a newer run ran the same entry and run row with other eval values only (an eval axis added, removed, or
   * changed since): the cell is a configuration the project moved away from.
   */
  superseded: v.boolean(),
})

/**
 * `GET /api/matrix?workspace=&project=&experiment=`: the matrix of every run in scope.
 */
export const matrixResponseSchema = v.object({
  /** Axes seen in scope with their distinct values, sorted; `kind` tells run-matrix from eval-matrix axes. */
  axes: v.array(v.object({
    kind: v.picklist(['run', 'eval']),
    name: v.string(),
    values: v.array(v.string()),
  })),
  cells: v.array(matrixCellSchema),
  /** Runs that were read to build the cells. */
  runCount: v.number(),
  /** Latest `score.defined` of each score in the cells. */
  scoreDefinitions: v.array(scoreDefinedDataSchema),
})

export const screenshotTimelineSchema = v.object({
  frames: v.array(v.object({
    artifactId: v.string(),
    contentType: v.string(),
    occurredAt: v.optional(v.string()),
    /** Path relative to the evidence directory; pass to `/evidence/:linkId/raw?path=`. */
    path: v.string(),
    purpose: v.optional(v.string()),
    runId: v.string(),
  })),
})

export const externalLogsResponseSchema = v.object({
  /** Keys a log line's `caseId` was matched against. */
  correlation: v.object({
    keys: v.array(v.string()),
    podNames: v.array(v.string()),
    window: v.object({ from: v.optional(v.string()), to: v.optional(v.string()) }),
  }),
  files: v.array(v.object({ matched: v.number(), path: v.string() })),
  lines: v.array(v.object({
    file: v.string(),
    line: v.number(),
    record: v.unknown(),
  })),
  nextOffset: v.nullable(v.number()),
  total: v.number(),
})

// ---------------------------------------------------------------------------------------------------------------
// OTEL
// ---------------------------------------------------------------------------------------------------------------

export const otelSpanSchema = v.object({
  attributes: v.record(v.string(), v.unknown()),
  endTime: v.optional(v.string()),
  kind: v.picklist(['run', 'project', 'task', 'round', 'case', 'try']),
  name: v.string(),
  parentSpanId: v.optional(v.string()),
  spanId: v.string(),
  startTime: v.optional(v.string()),
  status: v.picklist(['unset', 'ok', 'error']),
})

export const otelTracesResponseSchema = v.object({
  /** Always `events`: spans rebuilt from run events (no OTLP receiver). */
  source: v.literal('events'),
  spans: v.array(otelSpanSchema),
  traceId: v.string(),
})

export const otelLogsResponseSchema = v.object({
  records: v.array(v.object({
    attributes: v.record(v.string(), v.unknown()),
    body: v.string(),
    severity: v.picklist(['INFO', 'WARN', 'ERROR']),
    spanId: v.optional(v.string()),
    time: v.string(),
  })),
  source: v.literal('events'),
})

export const otelMetricsResponseSchema = v.object({
  metrics: v.array(v.object({
    dataPoints: v.array(v.object({
      attributes: v.record(v.string(), v.unknown()),
      time: v.string(),
      value: v.number(),
    })),
    name: v.string(),
    type: v.literal('gauge'),
  })),
  source: v.literal('events'),
})

// ---------------------------------------------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------------------------------------------

export const comparedRunSchema = v.object({
  attemptId: v.string(),
  counts: caseCountsSchema,
  durationMs: v.optional(v.number()),
  experimentId: v.string(),
  headline: v.nullable(headlineResultSchema),
  runKey: v.string(),
  startedAt: v.optional(v.string()),
  state: runStateSchema,
})

export const comparisonCellSchema = v.object({
  roundCount: v.number(),
  scores: caseScoresSchema,
  state: caseStateSchema,
})

export const comparisonResponseSchema = v.object({
  /** Columns: one per experiment (`experiments` view) or one per run (`attempts` / `runs` views). */
  columns: v.array(v.object({
    id: v.string(),
    label: v.string(),
    runs: v.array(comparedRunSchema),
    /** Graders that produced each score in the column's runs. */
    scoreGraders: scoreGradersSchema,
  })),
  /** Primary score the rows compare, when the columns share one. */
  primary: v.optional(v.string()),
  /** Rows: one per case name; `cells[columnId]` is the case result in that column (latest run of the column). */
  rows: v.array(v.object({
    caseName: v.string(),
    cells: v.record(v.string(), comparisonCellSchema),
    /** `true` when the case state or the primary score differs between columns. */
    changed: v.boolean(),
  })),
  /** Latest `score.defined` of each score in the cells. */
  scoreDefinitions: v.array(scoreDefinedDataSchema),
  summary: v.object({
    changed: v.number(),
    rows: v.number(),
  }),
  view: v.picklist(['experiments', 'attempts', 'runs']),
})

export const errorResponseSchema = v.object({
  message: v.string(),
  status: v.number(),
})

export type ArtifactDescriptor = v.InferOutput<typeof artifactDescriptorSchema>
export type CaseCounts = v.InferOutput<typeof caseCountsSchema>
export type CaseDetail = v.InferOutput<typeof caseDetailSchema>
export type CaseNode = v.InferOutput<typeof caseNodeSchema>
export type CaseRound = v.InferOutput<typeof caseRoundSchema>
export type CaseScores = v.InferOutput<typeof caseScoresSchema>
export type CaseScoring = v.InferOutput<typeof caseScoringSchema>
export type CaseState = v.InferOutput<typeof caseStateSchema>
export type CellCoverage = v.InferOutput<typeof cellCoverageSchema>
export type ComparedRun = v.InferOutput<typeof comparedRunSchema>
export type ComparisonCell = v.InferOutput<typeof comparisonCellSchema>
export type ComparisonResponse = v.InferOutput<typeof comparisonResponseSchema>
export type CurrentPosition = v.InferOutput<typeof currentPositionSchema>
export type EventsResponse = v.InferOutput<typeof eventsResponseSchema>
export type EvidenceLink = v.InferOutput<typeof evidenceLinkSchema>
export type ExternalLogsResponse = v.InferOutput<typeof externalLogsResponseSchema>
export type FileEntry = v.InferOutput<typeof fileEntrySchema>
export type FileTreeResponse = v.InferOutput<typeof fileTreeResponseSchema>
export type HeadlineResult = v.InferOutput<typeof headlineResultSchema>
export type ImagePreview = v.InferOutput<typeof imagePreviewSchema>
export type JsonlPage = v.InferOutput<typeof jsonlPageSchema>
export type LogLine = v.InferOutput<typeof logLineSchema>
export type LogsResponse = v.InferOutput<typeof logsResponseSchema>
export type MatrixCell = v.InferOutput<typeof matrixCellSchema>
export type MatrixResponse = v.InferOutput<typeof matrixResponseSchema>
export type MetricDefinition = v.InferOutput<typeof metricDefinedDataSchema>
export type MetricEntry = v.InferOutput<typeof metricEntrySchema>
export type MetricsResponse = v.InferOutput<typeof metricsResponseSchema>
export type OtelLogsResponse = v.InferOutput<typeof otelLogsResponseSchema>
export type OtelMetricsResponse = v.InferOutput<typeof otelMetricsResponseSchema>
export type OtelSpan = v.InferOutput<typeof otelSpanSchema>
export type OtelTracesResponse = v.InferOutput<typeof otelTracesResponseSchema>
export type PreviewKind = ArtifactDescriptor['previewKind']
export type ProgressResponse = v.InferOutput<typeof progressResponseSchema>
export type ProjectNode = v.InferOutput<typeof projectNodeSchema>
export type RunEvent = v.InferOutput<typeof runEventSchema>
export type RunIdentity = v.InferOutput<typeof runIdentitySchema>
export type RunListItem = v.InferOutput<typeof runListItemSchema>
export type RunProgress = v.InferOutput<typeof runProgressSchema>
export type RunSnapshot = v.InferOutput<typeof runSnapshotSchema>
export type RunSource = v.InferOutput<typeof runSourceSchema>
export type RunState = v.InferOutput<typeof runStateSchema>
export type ScoreDefinition = v.InferOutput<typeof scoreDefinedDataSchema>
export type ScoreGraders = v.InferOutput<typeof scoreGradersSchema>
export type ScoresResponse = v.InferOutput<typeof scoresResponseSchema>
export type ScoreSummary = v.InferOutput<typeof scoreSummarySchema>
export type ScreenshotTimeline = v.InferOutput<typeof screenshotTimelineSchema>
export type TaskMatrix = v.InferOutput<typeof taskMatrixSchema>
export type TaskNode = v.InferOutput<typeof taskNodeSchema>
export type TimelineResponse = v.InferOutput<typeof timelineResponseSchema>
export type TreeResponse = v.InferOutput<typeof treeResponseSchema>
export type TryNode = v.InferOutput<typeof tryNodeSchema>

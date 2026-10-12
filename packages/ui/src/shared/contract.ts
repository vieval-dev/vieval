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

import * as v from 'valibot'

/** Version of this contract, reported by `GET /api/health`. */
export const VIEWER_API_VERSION = 1

const nullableNumber = v.nullable(v.number())

// ---------------------------------------------------------------------------------------------------------------
// Runs and the report hierarchy
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where the data of a run comes from.
 *
 * - `live-bus`: a run of this process (`vieval run --with-viewer`), fed by its in-process event bus.
 * - `live-tail`: a run written by another process; its `events.jsonl` is tailed incrementally.
 * - `offline`: a finished run read from its report directory.
 * - `legacy`: a report written with event schema version 1; only `run-summary.json` / `cases.jsonl` are read.
 */
export const runSourceSchema = v.picklist(['live-bus', 'live-tail', 'offline', 'legacy'])

/**
 * Run state.
 *
 * `stale` means: no terminal event, and the last event is older than the stale threshold (the writer probably
 * died). It is shown, not guessed as failed.
 */
export const runStateSchema = v.picklist(['running', 'stale', 'ended', 'interrupted', 'legacy'])

export const runIdentitySchema = v.object({
  attemptId: v.string(),
  experimentId: v.string(),
  runId: v.string(),
  workspaceId: v.string(),
})

export const caseCountsSchema = v.object({
  failed: v.number(),
  passed: v.number(),
  running: v.number(),
  skipped: v.number(),
  timeout: v.number(),
  total: v.number(),
})

export const runListItemSchema = v.object({
  ...runIdentitySchema.entries,
  counts: caseCountsSchema,
  endedAt: v.optional(v.string()),
  exactAverage: nullableNumber,
  hybridAverage: nullableNumber,
  judgeAverage: nullableNumber,
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

export const caseStateSchema = v.picklist(['running', 'passed', 'failed', 'skipped', 'timeout', 'unfinished'])

export const tryNodeSchema = v.object({
  autoRetry: v.number(),
  endedAt: v.optional(v.string()),
  /** Retried tries end when the next try starts. */
  retryIndex: v.number(),
  startedAt: v.string(),
  /** `retried`: this try failed and the case was retried. */
  state: v.union([caseStateSchema, v.literal('retried')]),
})

export const scoreValuesSchema = v.object({
  exact: v.optional(v.number()),
  judge: v.optional(v.number()),
})

export const caseRoundSchema = v.object({
  endedAt: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  roundIndex: v.number(),
  roundIndexInferred: v.boolean(),
  /** Scores recorded with `recordScore` during this round. */
  scores: scoreValuesSchema,
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
  evidenceLinkCount: v.number(),
  index: v.number(),
  /** `taskId + '\u0000' + caseId`, the same key `cases.jsonl` tooling uses. */
  key: v.string(),
  logLineCount: v.number(),
  metricCount: v.number(),
  name: v.string(),
  projectId: v.optional(v.string()),
  rounds: v.array(caseRoundSchema),
  /** Scores of the last round. */
  scores: scoreValuesSchema,
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
  /** Score of the task: every round's case outcome, averaged (the rule of `describeTask`). */
  scores: v.object({
    exact: nullableNumber,
    hybrid: nullableNumber,
    judge: nullableNumber,
  }),
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
})

export const runSnapshotSchema = v.object({
  current: currentPositionSchema,
  endedAt: v.optional(v.string()),
  eventCounts: v.record(v.string(), v.number()),
  identity: runIdentitySchema,
  interruptSignal: v.optional(v.string()),
  /** Lines of `events.jsonl` that were not valid envelopes (live tail only). */
  parseErrors: v.number(),
  progress: runProgressSchema,
  projects: v.array(projectNodeSchema),
  runKey: v.string(),
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
    exactAverage: nullableNumber,
    hybridAverage: nullableNumber,
    judgeAverage: nullableNumber,
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
  metrics: v.array(metricEntrySchema),
  output: v.optional(v.unknown()),
  taskDisplayName: v.string(),
})

export const timelineEntrySchema = v.object({
  caseId: v.string(),
  durationMs: v.optional(v.number()),
  endedAt: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  name: v.string(),
  retryIndex: v.number(),
  roundIndex: v.number(),
  roundIndexInferred: v.boolean(),
  startedAt: v.string(),
  state: v.union([caseStateSchema, v.literal('retried')]),
  taskId: v.string(),
})

export const timelineResponseSchema = v.object({
  entries: v.array(timelineEntrySchema),
  /** Rounds per task: `[{taskId, rounds: [{roundIndex, startedAt, endedAt, passed, failed}]}]`. */
  rounds: v.array(v.object({
    rounds: v.array(v.object({
      endedAt: v.optional(v.string()),
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
})

const scoreTripleSchema = v.object({
  exact: nullableNumber,
  hybrid: nullableNumber,
  judge: nullableNumber,
})

export const scoresResponseSchema = v.object({
  byRound: v.array(v.object({
    roundIndex: v.number(),
    ...scoreTripleSchema.entries,
    taskId: v.string(),
  })),
  byTask: v.array(v.object({
    displayName: v.string(),
    matrix: v.optional(taskMatrixSchema),
    ...scoreTripleSchema.entries,
    taskId: v.string(),
  })),
  cases: v.array(v.object({
    caseId: v.string(),
    name: v.string(),
    scores: scoreValuesSchema,
    state: caseStateSchema,
    taskId: v.string(),
  })),
  /** From the run's events (all rounds, `describeTask` rule). */
  overall: scoreTripleSchema,
  /** From `run-summary.json`, once written. */
  summary: v.optional(scoreTripleSchema),
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
 * One cell of the matrix overview: one eval entry × run-matrix row × eval-matrix row, across the runs in scope.
 */
export const matrixCellSchema = v.object({
  /** Eval entry id parsed from the task id (`evals%2Fosworld%2F…`); one entry is one table in the UI. */
  entryId: v.string(),
  eval: v.record(v.string(), v.string()),
  evalRowId: v.string(),
  /** Every run that executed this cell, oldest first (one point per run for the cell's sparkline). */
  history: v.array(v.object({
    exact: nullableNumber,
    runKey: v.string(),
    startedAt: v.optional(v.string()),
    state: v.string(),
  })),
  /** Result of the newest run that executed this cell. */
  latest: v.object({
    attemptId: v.string(),
    counts: caseCountsSchema,
    exact: nullableNumber,
    experimentId: v.string(),
    judge: nullableNumber,
    runKey: v.string(),
    startedAt: v.optional(v.string()),
    /** Task state (see `TaskNode.state`). */
    state: v.string(),
    taskId: v.string(),
  }),
  run: v.record(v.string(), v.string()),
  runRowId: v.string(),
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
  exactAverage: nullableNumber,
  experimentId: v.string(),
  hybridAverage: nullableNumber,
  judgeAverage: nullableNumber,
  runKey: v.string(),
  startedAt: v.optional(v.string()),
  state: runStateSchema,
})

export const comparisonCellSchema = v.object({
  exact: v.optional(v.number()),
  judge: v.optional(v.number()),
  roundCount: v.number(),
  state: caseStateSchema,
})

export const comparisonResponseSchema = v.object({
  /** Columns: one per experiment (`experiments` view) or one per run (`attempts` / `runs` views). */
  columns: v.array(v.object({
    id: v.string(),
    label: v.string(),
    runs: v.array(comparedRunSchema),
  })),
  /** Rows: one per case name; `cells[columnId]` is the case result in that column (latest run of the column). */
  rows: v.array(v.object({
    caseName: v.string(),
    cells: v.record(v.string(), comparisonCellSchema),
    /** `true` when the case state or exact score differs between columns. */
    changed: v.boolean(),
  })),
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
export type CaseState = v.InferOutput<typeof caseStateSchema>
export type ComparedRun = v.InferOutput<typeof comparedRunSchema>
export type ComparisonCell = v.InferOutput<typeof comparisonCellSchema>
export type ComparisonResponse = v.InferOutput<typeof comparisonResponseSchema>
export type CurrentPosition = v.InferOutput<typeof currentPositionSchema>
export type EventsResponse = v.InferOutput<typeof eventsResponseSchema>
export type EvidenceLink = v.InferOutput<typeof evidenceLinkSchema>
export type ExternalLogsResponse = v.InferOutput<typeof externalLogsResponseSchema>
export type FileEntry = v.InferOutput<typeof fileEntrySchema>
export type FileTreeResponse = v.InferOutput<typeof fileTreeResponseSchema>
export type ImagePreview = v.InferOutput<typeof imagePreviewSchema>
export type JsonlPage = v.InferOutput<typeof jsonlPageSchema>
export type LogLine = v.InferOutput<typeof logLineSchema>
export type LogsResponse = v.InferOutput<typeof logsResponseSchema>
export type MatrixCell = v.InferOutput<typeof matrixCellSchema>
export type MatrixResponse = v.InferOutput<typeof matrixResponseSchema>
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
export type ScoresResponse = v.InferOutput<typeof scoresResponseSchema>
export type ScreenshotTimeline = v.InferOutput<typeof screenshotTimelineSchema>
export type TaskMatrix = v.InferOutput<typeof taskMatrixSchema>
export type TaskNode = v.InferOutput<typeof taskNodeSchema>
export type TimelineResponse = v.InferOutput<typeof timelineResponseSchema>
export type TreeResponse = v.InferOutput<typeof treeResponseSchema>
export type TryNode = v.InferOutput<typeof tryNodeSchema>

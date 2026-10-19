# `@vieval/ui` HTTP API (contract version 1)

The machine-readable contract is `src/shared/contract.ts`: one Valibot schema per response, with the TypeScript
types inferred from it. `src/server/app.test.ts` validates real responses (copied OSWorld reports) against these
schemas. This document explains the routes and the rules behind the numbers.

- Base path: `/api`. All responses are JSON unless stated otherwise.
- Errors: `{ "status": number, "message": string }` with the HTTP status (`400` bad parameter, `403` refused path
  or host, `404` unknown run/task/case/file/route, `413` image too large to preview, `415` not a previewable image, `416` unsatisfiable range, `500` bug).
- Run key (`:runKey`): the vieval `runId` (`run-<ms>-<uuid8>`). It is unique across report roots and the same for a
  run attached in-process and its report directory.
- Task and case ids are passed as **query parameters** (`?taskId=&caseId=`), URL-encoded. A `taskId` or `caseId`
  that the run does not contain is a `404`, also on list routes that use them as filters (`artifacts`, `evidence`,
  `logs`, `metrics`, `timeline`). The ids already contain encoded characters (`evals%2Fosworld%2F…::run=model%3Dgpt-5.5…`, `1:chrome%2F06fe…`),
  which path routing would decode inconsistently.

## Vocabulary

| Term | Meaning |
|---|---|
| workspace / project / experiment / attempt | Labels of a run (report path segments `<workspace>/<project>/<experiment>/<attempt>/<run>`). The run-level `attemptId` (`--attempt`) never re-runs anything. |
| run | One project of one `vieval run` invocation (vieval writes one run per project). |
| task | One scheduled task (one matrix row of one eval entry). `matrix` is parsed from the task id. |
| round (`roundIndex`) | One **auto attempt** of a task (`autoAttempt`: every case of the task runs again). Equals the scheduler's `attemptIndex`. `roundIndexInferred: true` when the log has no `attemptIndex` and the round was derived from repeated `case.started` events. |
| try (`retryIndex`) | One immediate retry of one case inside one round (`autoRetry`). A failed try that was retried has state `retried`. |
| case state | State of the case's last round. `unfinished`: the run ended (or was interrupted) before the case ended. |
| task state | `failed` when vieval's `task.ended` says `failed` (the task threw) **or** when a case of the task ended `failed` or `timeout` (vieval reports such tasks as `passed`). `unfinished`: the run ended before the task did. A project row shows `failed` when one of its tasks did. |

## Data sources

| `source` | When | How |
|---|---|---|
| `live-bus` | Run of this process (`vieval run --with-viewer`) | `onRunReady` → `bus.onAny`; every event from `seq` 1. |
| `live-tail` | Run directory without an end event and without `run-summary.json` (another process is writing it) | Byte-offset tail of `events.jsonl`: only complete lines, a half-written line waits for the next read, multi-byte characters stay intact, a truncated or replaced file restarts from byte 0. `fs.watch` + 1 s polling while a stream is open; on demand otherwise. |
| `offline` | Run directory with an end event or `run-summary.json` | Same reader, read to the end once; official numbers from `run-summary.json`. |
| `legacy` | `events.jsonl` with event schema version 1 | Rebuilt from `cases.jsonl` + `run-summary.json` (no rounds, retries, logs). |

All sources feed one reducer (`src/shared/reduce.ts`). Envelopes with a `seq` at or below the last applied one are
dropped (duplicates); missing numbers are counted in `seqGaps`; invalid lines in `parseErrors`.

`state`: `running`, `stale` (no end event and the last event is older than `--stale-after`, default 60 min),
`ended`, `interrupted` (`run.interrupted` or `interruptSignal` in the summary), `legacy`.

## Routes

### Hierarchy

| Route | Response | Notes |
|---|---|---|
| `GET /api/health` | `{ ok, apiVersion, mode, reportRoots, evidenceRoots, logDirectories }` | |
| `GET /api/tree` | `TreeResponse` | `workspaces[].projects[].experiments[].attempts[].runs[]` (`RunListItem`). Project = report path segment. Current vieval writes one run per project; older reports may use `multi-project` for runs of several projects (see `projectIds`). |
| `GET /api/runs?workspace=&project=&experiment=&attempt=&state=&source=` | `RunListItem[]` | Newest first. `counts`, `exactAverage`/`judgeAverage`/`hybridAverage` (from `run-summary.json` once written, else from events). `reportRoot` is the absolute report root the run was found in (tells archived roots apart), `reportPath` the directory below it. `matrix`: run-matrix axes of the run's tasks with their distinct values in natural order (`{ model: ['gpt-5.5'], repeat: ['1', '2', '10'] }`), `{}` without a run matrix. |
| `GET /api/runs/:runKey` | `RunListItem` | |

### Run

| Route | Response | Notes |
|---|---|---|
| `GET /api/runs/:runKey/snapshot` | `RunSnapshot` | Identity, state, `seq`, projects, tasks → cases → rounds → tries (the execution tree), `progress`, `current`, `summary`, `eventCounts`. |
| `GET /api/runs/:runKey/progress` | `ProgressResponse` | `progress` + `current` + `state` + `seq`, for polling. |
| `GET /api/runs/:runKey/events?after=<seq>&limit=<1..5000>` | `{ events, nextAfter, seq }` | Raw envelopes after `after` (default 0, limit default 1000). |
| `GET /api/runs/:runKey/stream?after=<seq>` | `text/event-stream` | See "Live updates". `Last-Event-ID` is honored. |
| `GET /api/runs/:runKey/task?taskId=` | `TaskNode` | |
| `GET /api/runs/:runKey/case?taskId=&caseId=` | `CaseDetail` | Node + `input`, `output`, `metrics`, `metricDefinitions` (latest `metric.defined` of each metric), `artifacts` (with `label` / `description` when recorded), `evidence`, `inference` (inference and tool-call events), `taskDisplayName`. |
| `GET /api/runs/:runKey/timeline?taskId=&caseId=` | `TimelineResponse` | Every try with round, retry index, times, state; per task a summary per round (passed/failed/running, start/end). |
| `GET /api/runs/:runKey/logs?taskId=&caseId=&stream=stdout\|stderr&round=&offset=&limit=<1..5000>` | `LogsResponse` | Console output of cases (`case.output`), split into lines. Output outside cases is not recorded by vieval. |
| `GET /api/runs/:runKey/metrics?taskId=&caseId=` | `MetricsResponse` | Numeric metrics as series with `min/max/avg/sum/count`; other values listed; `definitions`: the latest `metric.defined` (label, description, unit, better) of each listed metric; inference totals. |
| `GET /api/runs/:runKey/scores` | `ScoresResponse` | `overall`, `byTask`, `byRound`, `cases`, `summary` (from `run-summary.json`). |

**Score rule** (same as `describeTask`): every settled round of every case contributes; a case that did not pass
scores exact 0; a passed case without `recordScore` scores exact 1; otherwise its recorded `exact` (default 1) and
`judge`. `hybrid = (exact + judge) / 2` when both exist. Task scores are averaged into `overall`.

**Progress and ETA**: `T` = `run.started.totalTasks`; a task's case total is its first `case.started.total` (unknown
until the task starts; unknown totals are extrapolated from the mean of known ones: `basis:
'cases+task-extrapolation'`). `completed` = settled rounds, `running` = rounds in progress, `elapsedMs` = now (or the
end time) − `run.started`. Throughput ETA (the rule of the terminal reporter):
`round(elapsedMs / completed × estimatedTotal) − elapsedMs`, at least 0. While rounds are running, `etaMs` is the
larger of the throughput ETA and the time the longest running round has run so far (a case that has run for `t` is
expected to need about `t` more). `estimatedTotalMs = elapsedMs + etaMs`. Before the first case settles: `basis:
'unknown'`, no ETA. Once a round > 0 was seen, `lowerBound: true` (more auto attempts may follow). In auto-attempt
mode vieval emits the `case.ended` events of a round only when the whole round settled, so every case of the
round shows as running until then.

**Progress history**: `progress.history` is `completed` over time for a progress chart: `{ completed, elapsedMs }`
points, starting at `{ 0, 0 }` and ending at the current `{ completed, elapsedMs }` (now, or the end of the run). One
point per settlement (a settled round that starts again counts down). Above 240 points the span is cut into 238
equal time buckets and the last point of each is kept, so the series never exceeds 240 points and every kept point
is an exact count. Projection: draw from the last point to `(estimatedTotalMs, cases.estimatedTotal)`; it is a lower
bound when `lowerBound` is `true`.

**Current position**: `current.running` lists the cases whose last round has not ended, with round, retry index,
start time, and elapsed time; `current.lastEvent` is the last applied event.

### Artifacts

| Route | Response | Notes |
|---|---|---|
| `GET /api/runs/:runKey/artifacts?taskId=&caseId=` | `ArtifactDescriptor[]` | `artifact.recorded` events (`source: 'event'`) plus files found in `artifacts/<task>/<case>/` without an event (`source: 'directory'`). `previewKind`: `image`, `video`, `audio`, `jsonl`, `json`, `yaml`, `toml`, `text`, `html`, `binary` (content type first, extension second). |
| `GET /api/runs/:runKey/artifacts/raw?path=&download=1` | file | `path` relative to the run's artifacts root. Single `Range: bytes=` requests → `206` + `Content-Range`; unsatisfiable → `416`. Always `X-Content-Type-Options: nosniff`; HTML and SVG get `Content-Security-Policy: sandbox; default-src 'none'; …` (shown in an iframe, scripts never run with the viewer origin). |
| `GET /api/runs/:runKey/artifacts/jsonl?path=&offset=&limit=<1..1000>` | `JsonlPage` | Line-indexed paging (the index grows with the file). Only complete lines; `partialTail: true` while the last line is being written; a non-JSON line is returned as `{ "$raw", "$error" }`. |
| `GET /api/runs/:runKey/artifacts/preview?path=` | `ImagePreview` | `{ width, height, thumbhash }` of a raster image: its size and a base64 [ThumbHash](https://evanw.github.io/thumbhash/), so a client can reserve the image box and paint a blurred placeholder before the file loads. See "Image previews". |

### External evidence

Evals that keep evidence outside vieval (OSWorld writes `episodes/<task>/<time>-<model>-r<n>/`) record its location
with a metric whose name matches `*.evidence` (`osworld.evidence`). Each such metric with an absolute path becomes an
evidence link.

| Route | Response | Notes |
|---|---|---|
| `GET /api/runs/:runKey/evidence?taskId=&caseId=` | `EvidenceLink[]` | `allowed: false` (with `reason`) when the path, after symlinks, is outside the evidence roots: the parent of each report root (the `.vieval` directory) plus `--evidence-root`. `adapter: 'osworld'` when the directory has a `result.json` with `taskId` + `podName`; `summary` holds its fields (`status`, `score`, `podName`, `agentSteps`, …). |
| `GET /api/runs/:runKey/evidence/:linkId` | `EvidenceLink` | `403` when not allowed, `404` when missing. |
| `GET /api/runs/:runKey/evidence/:linkId/tree` | `FileTreeResponse` | Recursive listing (≤ 5000 entries, symlinks not listed). |
| `GET /api/runs/:runKey/evidence/:linkId/raw?path=` | file | Same rules as artifact `raw`; `path` relative to the evidence directory. |
| `GET /api/runs/:runKey/evidence/:linkId/jsonl?path=&offset=&limit=` | `JsonlPage` | |
| `GET /api/runs/:runKey/evidence/:linkId/preview?path=` | `ImagePreview` | Same as artifact `preview`; `path` relative to the evidence directory. |
| `GET /api/runs/:runKey/evidence/:linkId/timeline` | `ScreenshotTimeline` | AUV `auv-runs/records.jsonl` image artifacts mapped to `auv-runs/artifacts/<run>/<artifact>.<ext>`, in agent run order. |
| `GET /api/runs/:runKey/case/external-logs?taskId=&caseId=&offset=&limit=<1..2000>` | `ExternalLogsResponse` | Lines of `<.vieval>/logs/*.jsonl` whose `caseId` is one of the case's keys (vieval case id, case name, its last path segment, `input.task.id`, `result.json` `taskId`), whose `podName` (when present) is one of the case's pods (`osworld.pod` metric, `result.json`), and whose `time` is inside the case window (first start − 5 s … last end + 30 s). `correlation` reports the keys, pods, and window used. Files are indexed incrementally, so growing logs are cheap. Lines of another run match only if they share a key and a pod and fall in the window; pod names that are reused across runs can therefore match. |

#### Image previews

- Computed on demand on the server: the image is decoded, scaled so its longer side is at most 100 px (never
  upscaled), and hashed. Path rules are the same as for `raw`.
- `415` for files that are not raster images (SVG included: untrusted vector files are never rasterized) or that
  cannot be decoded; `413` for files over 50 MiB; `404` when missing.
- Cached in memory per server by real path, size, and modification time (at most 1000 previews, least recently used
  dropped first), so a rewritten file gets a new preview. At most 4 images are decoded at once; concurrent requests
  for the same file share one decode. Failures are not cached. Responses carry no `Cache-Control` header.

### OpenTelemetry (simple)

| Route | Response |
|---|---|
| `GET /api/runs/:runKey/otel/traces` | Span tree `run → project → task → (round) → case → (try)` rebuilt from events, with ids, times, status. |
| `GET /api/runs/:runKey/otel/logs` | Console lines (INFO/WARN), case failures and inference failures (ERROR), interruption (WARN). |
| `GET /api/runs/:runKey/otel/metrics` | Gauges: numeric metrics, `vieval.case.duration_ms`, `vieval.case.score.{exact,judge}`. |
| `GET /api/runs/:runKey/otel/raw/:signal` | `otlp/<traces\|logs\|metrics>.json` written by vieval when the run ended (`404` before). |

Limits: no OTLP receiver, no user-defined spans, no cross-process trace correlation, no sampling, querying, or
storage. Spans of the live OpenTelemetry runtime are not collected.

### Comparisons

All return `ComparisonResponse`: `columns` (each with the runs it covers), `rows` (one per case name; `cells[column]`
= `{ state, exact?, judge?, roundCount }`; `changed` when state or exact score differs between columns), `summary`.

| Route | Columns |
|---|---|
| `GET /api/compare/experiments?workspace=&project=` | One per experiment. A cell is the case result of the newest run of that experiment that contains the case. |
| `GET /api/compare/attempts?workspace=&project=&experiment=` | One per run of the experiment (attempt label + run id), oldest first. |
| `GET /api/compare/runs?runs=<runKey>,<runKey>[,…]` | The given runs, in order (≥ 2). |

### Matrix

| Route | Response | Notes |
|---|---|---|
| `GET /api/matrix?workspace=&project=&experiment=` | `MatrixResponse` | Every run in scope (filters as in `/api/runs`; none = all runs; an unknown value is an empty matrix). |

A cell is one eval entry × run-matrix row × eval-matrix row (from the task id). `latest` is the task of the newest
run (by start time) with that cell: run, experiment, attempt, task state, case counts, exact and judge score.
`history` lists every run with that cell, oldest first (one point per run: exact, state, start time). Two tasks of one
run in the same cell (several inference executors) keep the last one in queue order. `axes` lists the run-matrix axes,
then the eval-matrix axes, each with its values in natural order. Cells are ordered by entry, then run row and eval
row in natural order. Tasks whose id has no matrix are left out. The route builds every run's task nodes once.

## Live updates (SSE)

`GET /api/runs/:runKey/stream?after=<seq>` (or header `Last-Event-ID: <seq>`):

```text
retry: 2000

id: 151
event: run-event
data: {"seq":151,"event":"metric.recorded",…}     ← one envelope, in seq order, after `after`

event: progress
data: {"runKey":…,"state":"running","seq":170,"progress":{…},"current":{…}}   ← throttled (≥ 500 ms), and every 15 s

event: reset
data: {}                                            ← the file was replaced: refetch the snapshot

event: end
data: {"seq":251,"state":"ended"}                   ← terminal state reached; the server closes the stream

: ping                                              ← keep-alive every 15 s
```

Client pattern: `GET /snapshot`, then open the stream with `after=snapshot.seq` and apply each `run-event` with the
same reducer (`@vieval/ui/reduce`). Finished and legacy runs send their backlog, one `progress`, and `end`.

## Security

- The server binds `127.0.0.1` by default. Requests whose `Host` header is not `localhost`, `127.0.0.1`, `::1`, or
  the bound host are refused with `403` (DNS rebinding). Binding `0.0.0.0` accepts any host.
- Every file route resolves the requested path inside one root: empty or NUL → `400`; absolute paths, `..`
  segments that leave the root, and symlinks pointing out of it → `403`; missing → `404`.
- Evidence outside the allowed roots is described (`allowed: false`) but never listed or served.
- The viewer only reads report directories (`open(…, 'r')`); it never writes to them.

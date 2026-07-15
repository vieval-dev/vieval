---
title: Reports and Comparisons
prev:
  text: Reliable Execution
  link: /en/guide/learn/reliable-execution
---

# Reports and Comparisons

The default CLI summary answers what happened in the active terminal. Report artifacts retain the evidence needed to inspect cases, analyze several runs, and compare a baseline with a candidate later.

## Move from terminal output to retained artifacts

`vieval run` prints a human-readable summary by default. `--json` changes stdout to the machine-readable run output; it does not create files. Add `--report-out` when the run should also persist a report directory.

```bash [Terminal]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports
```

The command still prints its human-readable summary of the active run and its project, task, and case state. Add `--json` when a script needs the machine-readable run output, including the resolved `reportDirectory`, on stdout. The report directory created by `--report-out` remains available after the terminal session even though the human-readable summary does not print its path.

Without `--report-out`, `reportDirectory` is `null` and the `vieval report ...` commands have no new artifacts from that run to read.

## Know what a run writes

Vieval places each run under the report root by workspace, project, experiment, attempt, and generated run ID. A multi-project run uses `multi-project` for the project segment.

| Artifact | Confirmed contents |
| --- | --- |
| `run-summary.json` | The CLI run output, including identities, project status, case summaries and failures, matrix summaries, and aggregated run scores. |
| `events.jsonl` | Ordered run, task, case, score, metric, and custom event envelopes captured during execution. |
| `cases.jsonl` | One normalized final record per observed task/case, with identities, state, timing, a derived retry count, scores, metrics, and optional input/output. |
| `metrics-summary.json` | Overall score counts, sums, and averages derived from normalized case records. |
| `otlp/traces.json`, `otlp/logs.json`, `otlp/metrics.json` | Local OTLP-shaped projections derived from the case records. |

`vieval report index` creates another artifact, `index/runs.jsonl` by default. It is not written by `vieval run`.

Automatic attempts require one reading caveat. `run-summary.json` contains the task score aggregated from all completed attempt evidence, while `cases.jsonl` keeps a final projection for each task/case. Use `events.jsonl` when retry or attempt sequence matters.

The `retryCount` field is derived from lifecycle starts. When events do not provide a `retryIndex`, repeated starts from additional attempts may increase it too; use `events.jsonl` to distinguish retries from attempts precisely.

::: warning Treat report artifacts as potentially sensitive
Artifacts may contain case inputs and outputs, error messages, custom metrics, model or benchmark identifiers, and other event payloads. Store them under an appropriate retention policy, restrict access, and remove or redact fields that should not leave the evaluation environment.
:::

## Index, inspect, and analyze reports

Every report command requires a report path. It can usually be a single run directory or a higher report root that contains multiple runs.

```bash [Terminal — build a run index]
vieval report index <report-directory>
```

`index` discovers `run-summary.json` files recursively and writes compact run rows to `<report-directory>/index/runs.jsonl` unless `--output` changes the path. `--format table|json|jsonl` controls stdout, not the index file format.

```bash [Terminal — inspect normalized cases]
vieval report cases <report-directory>
```

`cases` reads `cases.jsonl`. Repeat `--where key=value` for equality filters, add `--group-by <key>` for grouped score summaries, and choose `--format table|json|jsonl`. JSON and JSONL are stdout formats; this command does not write a new case artifact.

```bash [Terminal — analyze runs]
vieval report analyze <report-directory>
```

`analyze` reads run summaries and events, filters runs, and rolls them up by workspace and experiment. Its filters include workspace, project, experiment, attempt, run, event or error text, and run/eval matrix selectors. `--task-state` and `--case-state` currently accept `passed`, `failed`, or `skipped`; `timeout` is not currently accepted by `--case-state`. `--format table|json|jsonl|csv` controls stdout.

## Compare two existing report sets

The report comparison command requires a left baseline and a right candidate:

```bash [Terminal]
vieval report compare <left-report-directory> <right-report-directory>
```

It reads normalized cases, aligns them by a case key, and reports matched deltas plus added and removed cases. Per-case and grouped deltas use matched records and are `right - left`; grouping uses the right-side record's selector value. A missing selected score on a matched case is treated as `0`. The overall delta instead subtracts the two full record-set means, ignoring records that lack the selected score, so additions and removals affect it and it is not the mean matched delta. `--score-kind <kind>` defaults to `exact`, and output can be `table` or `json`.

The default alignment key is the `benchmark.case.id` metric when present, then `vieval.case.id`, then the record's `caseId`. Use `--case-key <key>` when the benchmark has another stable identifier. An explicit key must exist on every record. Duplicate resolved keys on either side are an error rather than an arbitrary match.

Selectors used by `--case-key`, `--group-by`, and `report cases` look for an exact metric name first, then `scores.<name>` or a bare score name, then a direct case-record field. For example, `benchmark.category` can refer to a metric, while `state` refers to the normalized record field.

Do not confuse this command with top-level `vieval compare`:

- `vieval report compare <left> <right>` compares case artifacts that already exist.
- `vieval compare --config ... --comparison ...` loads a comparison-mode config, executes every configured method against one benchmark, shares the configured benchmark cache namespace, and can write its aggregate comparison artifact with `--output`.

## Run one complete comparison flow

The following flow retains two executions, indexes the combined root, inspects candidate cases, analyzes all runs, and finally compares case scores. It does not depend on a fabricated run ID because report commands discover runs recursively.

```bash [Terminal — retain the baseline]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports/baseline
```

```bash [Terminal — retain the candidate]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment candidate \
  --attempt attempt-a \
  --report-out .vieval/reports/candidate
```

```bash [Terminal — index all retained runs]
vieval report index .vieval/reports
```

```bash [Terminal — inspect candidate cases]
vieval report cases .vieval/reports/candidate \
  --where state=failed \
  --format jsonl
```

```bash [Terminal — analyze run-level reliability]
vieval report analyze .vieval/reports --format json
```

```bash [Terminal — compare aligned case scores]
vieval report compare \
  .vieval/reports/baseline \
  .vieval/reports/candidate \
  --case-key benchmark.case.id \
  --score-kind exact \
  --format table
```

The final command requires every case to emit a unique `benchmark.case.id`. Omit `--case-key` if that guarantee does not exist and the built-in fallback identities are appropriate.

A common failure is treating `--json` as persistence or pointing report commands at a directory created by a run that omitted `--report-out`. Another is aligning on generated or duplicate identifiers; comparison is meaningful only when the chosen key denotes the same benchmark case on both sides.

See [API](/en/api/) for public entrypoints and [Config](/en/config/) for the current configuration surface.

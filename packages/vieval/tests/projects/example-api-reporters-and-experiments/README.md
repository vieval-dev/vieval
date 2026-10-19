# example-api-reporters-and-experiments

Fixture project that demonstrates:

1. Reporter modes (`TTY`, `--json`, report artifacts, `report analyze`)
2. Evaluation layers:
   - `experiment`
   - `attempt`
   - `task`
   - `case`

## Structure

- `vieval.config.ts`
  - project-level `runMatrix` and `evalMatrix`
- `evals/intent-routing.eval.ts`
  - case-driven task via `casesFromInputs`
- `evals/answer-grounding.eval.ts`
  - case-driven task with scenario-aware checks

## Run With Default Reporter (TTY)

Reports are written by default to `.vieval/reports` next to the config. Add `--no-report` to skip them.

```bash
pnpm run eval:run -- --config tests/projects/example-api-reporters-and-experiments/vieval.config.ts
```

## Run With JSON Output

```bash
pnpm run eval:run -- --config tests/projects/example-api-reporters-and-experiments/vieval.config.ts --json
```

## Run With Persisted Artifacts (Experiment + Attempt)

Attempt 1:

```bash
pnpm run eval:run -- \
  --config tests/projects/example-api-reporters-and-experiments/vieval.config.ts \
  --experiment reliability-baseline \
  --attempt attempt-01 \
  --report-out .vieval/reports
```

Attempt 2:

```bash
pnpm run eval:run -- \
  --config tests/projects/example-api-reporters-and-experiments/vieval.config.ts \
  --experiment reliability-baseline \
  --attempt attempt-02 \
  --report-out .vieval/reports
```

`--report-out .vieval/reports` puts the report root under the current directory instead of next to the config.
Artifacts are written under (the workspace id is the config directory name, `example-api-reporters-and-experiments`,
and so is the project name):

```text
.vieval/reports/<workspaceId>/<projectId>/<experimentId>/<attemptId>/<runId>/
  run-summary.json
  events.jsonl
  cases.jsonl
```

## Analyze One Run Artifact

Table output:

```bash
vieval report analyze .vieval/reports/<workspaceId>/<projectId>/<experimentId>/<attemptId>/<runId>
```

JSON output:

```bash
vieval report analyze .vieval/reports/<workspaceId>/<projectId>/<experimentId>/<attemptId>/<runId> --format json
```

`events.jsonl` includes lifecycle events that bind the experiment/attempt/task/case layers together.

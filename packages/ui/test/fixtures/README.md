# Fixtures

`osworld/.vieval` is a trimmed copy of `moeru-ai/auv` PR 258 `evals/osworld/.vieval`, taken on 2026-10-12 while an
OSWorld run was executing on Kubernetes.

| Path | Origin |
|---|---|
| `reports/…/attempt-2026-10-11T19-31-43-580Z/run-1791747103580-dd3a8517/events.jsonl` | The run that was still executing: only `events.jsonl` existed. First 150 lines (seq 1–150). |
| `../osworld-running-continuation.jsonl` | The next 100 lines of that file (seq 151–250), appended by the live-tail tests. |
| `reports/…/attempt-2026-10-11T19-14-05-991Z/run-1791746045991-a77ba0a4/` | A finished run interrupted by SIGINT: `events.jsonl`, `run-summary.json`, `cases.jsonl`, `metrics-summary.json`, `otlp/`. |
| `reports/…/attempt-2026-10-10T18-20-50-009Z/run-1791656450009-5299b70e/` | A report with event schema version 1: written by an older vieval, so the viewer lists it as unsupported and does not open it. |
| `episodes/06fe7178-…/2026-10-11T19-14-06.064Z-gpt-5.5-r1/` | The evidence directory of case `1:chrome/06fe7178-…` of the interrupted run: `result.json` (agent steps cut to 3), `auv-runs/records.jsonl` and one screenshot, the first 4 kB of `bridge-evaluate.log`. |
| `logs/run-20261012-mcp-agent-b.jsonl` | The 24 command log lines of that case, plus two lines marked `"$fixture"` that must be filtered out (another pod; outside the case window). |

Changes to the copied data:

- The absolute `.vieval` path is replaced with `__VIEVAL_DIR__`; `test/helpers.ts` writes the temporary copy's path.
- Home directories and kubeconfig paths are replaced with `/home/user/…`.
- The two runs of event schema version 2 were rewritten to version 3 (named scores) without adding or removing
  lines, so every `seq` is the one the real run wrote:
  - every envelope has `schemaVersion: 3`
  - `score.recorded` `{ kind: 'exact', score }` became `{ name: 'osworld.success', value }`; no `score.defined` was
    added, so the score has no label and is the primary score as the task's only score
  - the interrupted run's `run-summary.json` is schema version 2: the `headline` and `scoreDefinitions` at the top,
    and `result` in the named-score shape; its `cases.jsonl` is schema version 2 (a failed case counts 0), and its
    `otlp/metrics.json` gauge is `vieval.score.osworld.success`

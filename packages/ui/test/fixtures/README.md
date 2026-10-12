# Fixtures

`osworld/.vieval` is a trimmed copy of `moeru-ai/auv` PR 258 `evals/osworld/.vieval`, taken on 2026-10-12 while an
OSWorld run was executing on Kubernetes.

| Path | Origin |
|---|---|
| `reports/…/attempt-2026-10-11T19-31-43-580Z/run-1791747103580-dd3a8517/events.jsonl` | The run that was still executing: only `events.jsonl` existed. First 150 lines (seq 1–150). |
| `../osworld-running-continuation.jsonl` | The next 100 lines of that file (seq 151–250), appended by the live-tail tests. |
| `reports/…/attempt-2026-10-11T19-14-05-991Z/run-1791746045991-a77ba0a4/` | A finished run interrupted by SIGINT: `events.jsonl`, `run-summary.json`, `cases.jsonl`, `metrics-summary.json`, `otlp/`. |
| `reports/…/attempt-2026-10-10T18-20-50-009Z/run-1791656450009-5299b70e/` | A report with event schema version 1 (legacy). |
| `episodes/06fe7178-…/2026-10-11T19-14-06.064Z-gpt-5.5-r1/` | The evidence directory of case `1:chrome/06fe7178-…` of the interrupted run: `result.json` (agent steps cut to 3), `auv-runs/records.jsonl` and one screenshot, the first 4 kB of `bridge-evaluate.log`. |
| `logs/run-20261012-mcp-agent-b.jsonl` | The 24 command log lines of that case, plus two lines marked `"$fixture"` that must be filtered out (another pod; outside the case window). |

Changes to the copied data:

- The absolute `.vieval` path is replaced with `__VIEVAL_DIR__`; `test/helpers.ts` writes the temporary copy's path.
- Home directories and kubeconfig paths are replaced with `/home/user/…`.

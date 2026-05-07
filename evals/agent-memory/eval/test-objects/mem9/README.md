# mem9 Test Object

mem9-backed LoCoMo test object under `evals/agent-memory`.

## Scope

- adapts mem9 retrieval API to LoCoMo benchmark-core contracts
- executes LoCoMo task definitions through `vieval` task context
- registers each LoCoMo QA as an independent Vieval case
- reuses benchmark-core deterministic answer-prediction cache artifacts

## Run

```bash
pnpm -F @vieval/eval-agent-memory typecheck
pnpm -F @vieval/eval-agent-memory eval:run:mem9
```

Set `LOCOMO_PREDICTION_CACHE=read-only` to replay already generated answers without allowing
new answer-generation model calls. The default mode is `read-write`.
The default config uses `concurrency.case = 4`; use `--case-concurrency <n>` to override
LoCoMo QA case concurrency for a run.

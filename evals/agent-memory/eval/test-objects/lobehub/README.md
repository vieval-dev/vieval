# lobehub Test Object

LobeHub-memory-backed LoCoMo test object under `evals/agent-memory`.

## Scope

- adapts LobeHub retrieval endpoint to LoCoMo benchmark-core contracts
- executes LoCoMo task definitions through `vieval` task context
- registers each LoCoMo QA as an independent Vieval case
- reuses benchmark-core deterministic answer-prediction cache artifacts

## Run

```bash
pnpm -F @vieval/eval-agent-memory typecheck
pnpm -F @vieval/eval-agent-memory eval:run:lobehub
```

For a local LobeHub dev server on port `3011`, configure `.env.local` or pass the benchmark endpoint and webhook auth envs:

```bash
LOBEHUB_BASE_URL="http://localhost:3011" \
LOCOMO_DATA_FILE="/path/to/locomo10.json" \
LOCOMO_MAX_SAMPLES=10 \
LOCOMO_MAX_CASES=50 \
LOCOMO_PREDICTION_CACHE=read-write \
pnpm -F @vieval/eval-agent-memory eval:run:lobehub -- --case-concurrency 4
```

`MEMORY_USER_MEMORY_WEBHOOK_HEADERS` is required when the LobeHub server has it configured,
because the benchmark search route uses the same header gate as the ingest webhook.
Use `LOCOMO_PREDICTION_CACHE=read-only` to replay already generated answers without allowing
new answer-generation model calls.
The default config uses `concurrency.case = 4`; use `--case-concurrency <n>` to override
the LoCoMo QA case concurrency for a run.

# lobehub Test Object

LobeHub-memory-backed LoCoMo test object under `evals/agent-memory`.

## Scope

- adapts LobeHub retrieval endpoint to LoCoMo benchmark-core contracts
- executes LoCoMo task definitions through `vieval` task context
- reuses benchmark-core deterministic case cache artifacts

## Run

```bash
pnpm -F @vieval/eval-agent-memory typecheck
pnpm -F @vieval/eval-agent-memory eval:run:lobehub
```

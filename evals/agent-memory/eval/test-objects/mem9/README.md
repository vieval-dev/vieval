# mem9 Test Object

mem9-backed LoCoMo test object under `evals/agent-memory`.

## Scope

- adapts mem9 retrieval API to LoCoMo benchmark-core contracts
- executes LoCoMo task definitions through `vieval` task context
- reuses benchmark-core deterministic case cache artifacts

## Run

```bash
pnpm -F @vieval/eval-agent-memory typecheck
pnpm -F @vieval/eval-agent-memory eval:run:mem9
```

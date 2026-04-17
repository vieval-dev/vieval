# @vieval/eval-agent-memory

Unified workspace for agent-memory evaluations.

## Layout

- `eval/cases/locomo`: shared LoCoMo case dataset + scoring/assertion providers
- `eval/test-objects/mem9`: mem9-specific adapters and LoCoMo tasks
- `eval/test-objects/lobehub`: lobehub-specific adapters and LoCoMo tasks

## Run

```bash
pnpm -F @vieval/eval-agent-memory eval:run
pnpm -F @vieval/eval-agent-memory eval:run:mem9
pnpm -F @vieval/eval-agent-memory eval:run:lobehub
```

`eval:run` executes comparison mode via `vieval compare` and discovers workspaces from
`eval/test-objects/*` declared in this workspace config.

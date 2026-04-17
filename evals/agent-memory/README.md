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

## LoCoMo Data Source

- `LOCOMO_DATA_FILE`: optional absolute path to Snap LoCoMo JSON (`locomo10.json`)
- `LOCOMO_MAX_SAMPLES`: optional number of leading samples to use (default: `1`)

Both mem9 and lobehub LoCoMo tasks derive cases from this dataset path.

## Live Snap QA Runner

Run live LoCoMo-style answer generation + scoring against Snap data with your configured provider:

```bash
set -a
source /Users/neko/Git/github.com/vieval-dev/vieval/evals/agent-memory/.env.local
set +a
LOCOMO_MAX_SAMPLES=1 LOCOMO_MAX_QUESTIONS=5 pnpm -F @vieval/eval-agent-memory locomo:run:snap-live-qa
```

Optional envs:
- `OPENAI_MODEL` (default `openai/gpt-4o-mini`)
- `LOCOMO_DATA_FILE` (default Snap `locomo10.json` path)
- `LOCOMO_MAX_SAMPLES` (default `1`)
- `LOCOMO_MAX_QUESTIONS` (default `5`)
- `LOCOMO_MAX_CASES` (for workspace eval tasks, default `5`)
- `LOCOMO_TOP_K` (retriever `topK`, default `10`)
- `LOCOMO_EVAL_CONCURRENCY` (parallel QA workers, default `4`)

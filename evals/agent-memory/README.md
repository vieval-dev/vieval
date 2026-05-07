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

Run live LoCoMo-style answer generation + scoring against LoCoMo data with your configured provider:

```bash
LOCOMO_MAX_SAMPLES=1 LOCOMO_MAX_QUESTIONS=5 pnpm -F @vieval/eval-agent-memory locomo:run:snap-live-qa
```

Optional envs:
- `OPENAI_MODEL` (default `openai/gpt-4o-mini`)
- `LOCOMO_DATA_FILE` (default repository first-sample fixture; set this to a full `locomo10.json` for benchmark runs)
- `LOCOMO_MAX_SAMPLES` (default `1`)
- `LOCOMO_MAX_QUESTIONS` (default `5`)
- `LOCOMO_MAX_CASES` (for workspace eval tasks, default `5`)
- `LOCOMO_TOP_K` (retriever `topK`, default `10`)
- `LOCOMO_PREDICTION_CACHE` (`read-write`, `read-only`, or `off`; default `read-write`)

Workspace eval tasks register each LoCoMo QA as a separate Vieval case. Prediction caching
stores generated answers under a key that includes dataset hash, prompt version, retriever id,
answer-generator id/model, `topK`, case id, and retrieved prompt context hash.
Workspace eval case concurrency uses standard Vieval concurrency settings; pass
`--case-concurrency <n>` to override it for one run.

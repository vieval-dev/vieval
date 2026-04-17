# @vieval/eval-agent-memory (LoCoMo Cases)

LoCoMo benchmark-core package for Vieval.

## What It Provides

- benchmark contracts (`retriever`, `answer-generator`, `judge`)
- canonical LoCoMo scoring functions
- deterministic cache-backed case derivation keyed by `dataset hash + schema version`
- shared evaluation pipeline for retrieval + generation + scoring with configurable concurrency
- shared `@xsai/generate-text` answer generator adapter for OpenAI-compatible providers

## Usage

```ts
import {
  deriveLoCoMoCases,
  deriveLoCoMoCasesFromSnapDataset,
  loadLoCoMoSamplesFromSnapDataset,
  loadOrDeriveLoCoMoCases,
  scoreLoCoMoAnswer,
} from '@vieval/eval-agent-memory'
```

## Python Parity Map

- `src/types.ts`:
  - dataset/QA field usage mirrors `task_eval/evaluate_qa.py:67-85,98-103`
  - category-based scoring consumption mirrors `task_eval/evaluation.py:199-239`
- `src/cases/derive-cases.ts`:
  - sample/qa normalization mirrors `task_eval/evaluate_qa.py:78-105`
- `src/pipeline/evaluate-locomo.ts`:
  - category 2/5 prompt transforms mirror `task_eval/gpt_utils.py:243-253`
  - category 5 option resolution mirrors `task_eval/gpt_utils.py:128-143`
  - aggregate category/overall mean mirrors `task_eval/evaluation_stats.py:94-109`
- `src/scoring/token-f1.ts`:
  - normalization + stemming mirror `task_eval/evaluation.py:75-92,127-128`
  - token F1 mirrors `task_eval/evaluation.py:126-138`
- `src/scoring/score-locomo-answer.ts`:
  - category routing mirrors `task_eval/evaluation.py:203-221`
  - category 1 multi-answer split mirrors `task_eval/evaluation.py:141-145`
  - category 3 first-span handling mirrors `task_eval/evaluation.py:203-205`
  - category 5 adversarial/no-info check mirrors `task_eval/evaluation.py:217-221`
- `src/cases/run-snap-live-qa.ts`:
  - conversation prompt framing mirrors `task_eval/gpt_utils.py:51-52,183-196`

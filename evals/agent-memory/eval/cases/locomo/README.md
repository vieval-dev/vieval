# @vieval/eval-agent-memory (LoCoMo Cases)

LoCoMo benchmark-core package for Vieval.

## What It Provides

- benchmark contracts (`retriever`, `answer-generator`, `judge`)
- canonical LoCoMo scoring functions
- deterministic cache-backed case derivation keyed by `dataset hash + schema version`

## Usage

```ts
import { deriveLoCoMoCases, loadOrDeriveLoCoMoCases, scoreLoCoMoAnswer } from '@vieval/eval-agent-memory'
```

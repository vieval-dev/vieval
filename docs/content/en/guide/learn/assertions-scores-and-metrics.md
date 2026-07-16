---
title: Assertions, Scores, and Metrics
prev:
  text: Tasks, Cases, and Inputs
  link: /en/guide/learn/tasks-cases-and-inputs
next:
  text: Models and Inference Executors
  link: /en/guide/learn/models-and-inference-executors
---

# Assertions, Scores, and Metrics

A case becomes useful evidence when it makes success observable. Start with deterministic assertions, then add normalized scores or report metadata only when the evaluation needs them.

## Start with a deterministic assertion

Vieval exports a Vitest-compatible `expect`. A failed matcher throws inside the case, so the case fails; a case that completes without a custom score contributes an `exact` score of `1`, while a failed case contributes `0`.

```ts [evals/normalized-answer.eval.ts]
import { describeTask, expect } from 'vieval'

describeTask('normalized answer', ({ caseOf }) => {
  caseOf('removes surrounding whitespace', () => {
    const answer = '  forty-two  '.trim()
    expect(answer).toBe('forty-two')
  })
})
```

This is the clearest starting point for exact values, schemas, required fields, and other rules that code can decide reliably.

## Separate the evidence types

| Term | Meaning in Vieval | Effect on a task case |
| --- | --- | --- |
| Assertion | A check that produces a pass/fail decision. `expect` controls the case by throwing on failure; `vieval/core/assertions` also exposes assertion functions that return structured outcomes. | A thrown matcher fails the case. Core assertion outcomes are not connected to the task DSL automatically. |
| Score | A normalized number in `0..1`, recorded with `context.score(value, kind)`. Public score kinds are `exact` and `judge`; `exact` is the default. | Contributes to task-result aggregation when the case passes. Its emitted event may also be persisted in a report case record. |
| Metric | Named benchmark metadata recorded with `context.metric(name, value)`. Values may be strings, numbers, booleans, `null`, or arrays of those telemetry values. | Appears in report events and case records, but does not change pass/fail state or score aggregation. |
| Rubric | An assertion whose `judge` callback returns a reason and normalized score, then compares that score with `minScore` (default `0.7`). | Produces an `AssertionOutcome` with score kind `judge`; the author decides how to bridge that outcome into a task case. |

The `score` and `metric` methods are available on the case callback context received by `caseOf` and `casesFromInputs`.

## Record scores and metrics from a case

Use `score` for a value that should be averaged. Use `metric` for dimensions or observations that reports should retain without treating them as the result itself.

```ts [evals/retrieval.eval.ts]
import { describeTask, expect } from 'vieval'

describeTask('retrieval', ({ caseOf }) => {
  caseOf('finds the expected documents', ({ metric, score }) => {
    const expected = new Set(['doc-a', 'doc-b'])
    const retrieved = ['doc-a', 'doc-c']
    const matches = retrieved.filter(id => expected.has(id)).length
    const recall = matches / expected.size

    score(recall, 'exact')
    metric('benchmark.case.id', 'retrieval-basic')
    metric('retrieved.count', retrieved.length)

    expect(recall).toBeGreaterThan(0)
  })
})
```

Scores must be finite and inside `0..1`. Within one case, another `score` call with the same kind replaces the earlier value; use one final value per score family.

Task-result aggregation and persisted report records have different timing. If a case later fails or times out, task-result aggregation ignores its custom score contributions and adds exact failure evidence. Each `score` call also emits an event immediately, however, so a score emitted before the failure may remain in the persisted case record. The case-end event supplies an exact `0` only when that record does not already have an exact score. When diagnosing a report, read the case `state` together with its recorded scores.

Metrics are evidence for filtering, grouping, and diagnosing reports. A metric alone never makes a case pass, fail, or receive a higher aggregate score.

## Use rubric assertions deliberately

The public `vieval/core/assertions` entrypoint includes `expectRubric` and `evaluateAssertions`. `expectRubric` creates an assertion. When evaluated, for example by `evaluateAssertions`, that assertion calls the `judge` function you provide, clamps its returned score to `0..1`, applies `minScore`, and produces a structured `AssertionOutcome`:

```ts [rubric.ts]
import { evaluateAssertions, expectRubric } from 'vieval/core/assertions'

const [outcome] = await evaluateAssertions([
  expectRubric({
    id: 'concise-answer',
    judge: async ({ text }) => ({
      reason: text.length <= 80 ? 'Answer is concise.' : 'Answer is too long.',
      score: text.length <= 80 ? 1 : 0,
    }),
    minScore: 0.8,
  }),
], {
  text: 'A short answer.',
})
```

This example is deterministic and makes no model call. `expectRubric` does not select a model or invoke a provider by itself. A `judge` callback may use local logic, a human result, or model inference.

The core assertion pipeline and the task DSL are currently separate public surfaces. `evaluateAssertions` returns outcomes; it does not automatically call the case callback context's `score`, `metric`, or `expect`. If you bridge an outcome manually, decide explicitly whether you are recording its numeric score, failing the case from `outcome.pass`, retaining its reason as a metric, or some combination. Throwing to fail a case makes the task result treat it as an exact failure; score events emitted before the throw may still appear in the persisted case record.

::: warning Model-backed judging has runtime consequences
If your `judge` callback invokes a model, it needs the relevant provider configuration and credentials and adds latency and cost. Case concurrency can fan out judge requests, so apply limits that match provider capacity. Review the provider's data policy and choose deliberately which case inputs, outputs, judge prompts, reasons, metrics, or events you retain in report artifacts.
:::

A common boundary error is treating a metric as a score or assuming a rubric outcome is wired into the case automatically. Keep the decision, numeric evidence, and diagnostic metadata separate in the code.

Next, learn how model registrations and runtime adapters fit this flow in [Models and Inference Executors](/en/guide/learn/models-and-inference-executors). The assertion primitives are listed under the public [`vieval/core/assertions` entrypoint](/en/api/).

---
title: Tasks, Cases, and Inputs
prev:
  text: Core Concepts
  link: /en/guide/core-concepts
next:
  text: Assertions, Scores, and Metrics
  link: /en/guide/learn/assertions-scores-and-metrics
---

# Tasks, Cases, and Inputs

This lesson turns a behavior you want to evaluate into a task with repeatable cases. By the end, you will know where case input appears at runtime and how to keep dataset rows comparable across reports.

## Define a task boundary

`describeTask` groups the cases for one evaluated behavior and registers that task when the evaluation module loads. Give the task a name that remains meaningful across the run and evaluation matrix variants that may expand it.

Use `caseOf` when the task has one named scenario:

```ts [evals/addition.eval.ts]
import { describeTask, expect } from 'vieval'

describeTask('addition', ({ caseOf }) => {
  caseOf('adds two positive numbers', ({ matrix }) => {
    const { a, b, expected } = matrix.inputs
    expect(a + b).toBe(expected)
  }, {
    input: { a: 20, b: 22, expected: 42 },
  })
})
```

The string passed to `caseOf` is the case's human-readable name. The `input` option becomes the callback's typed `matrix.inputs` value.

## Generate cases from a dataset

`casesFromInputs` registers one case for every item in a readonly array. The callback receives the complete array item, so the dataset can carry both the values under test and a stable identifier:

```ts [evals/addition-dataset.eval.ts]
import { describeTask, expect } from 'vieval'

const inputs = [
  { input: { a: 1, b: 2, expected: 3 }, name: 'addition-small' },
  { input: { a: 20, b: 22, expected: 42 }, name: 'addition-large' },
]

describeTask('addition', ({ casesFromInputs }) => {
  casesFromInputs('addition', inputs, ({ matrix, metric }) => {
    const { a, b, expected } = matrix.inputs.input

    metric('benchmark.case.id', matrix.inputs.name)
    expect(a + b).toBe(expected)
  })
})
```

This call registers `addition #1` and `addition #2`. The `name` property belongs to each input object; `casesFromInputs` does not use it as the generated case name. Here it is emitted as `benchmark.case.id`, which report comparison prefers as its stable matching key.

## Follow input resolution

The case callback context has a `matrix` that combines the resolved task matrix with the case input:

```text
project/eval/task matrix layers
  -> context.task.matrix.run / eval / meta

caseOf(..., { input }) or casesFromInputs(...)
  -> context.matrix.inputs
```

For the dataset example, `matrix.inputs` is one object from `inputs`, so the arithmetic values are under `matrix.inputs.input`. The dataset's `name` is therefore `matrix.inputs.name`.

`context.task.matrix` still contains only the scheduled run, evaluation, and metadata rows. Case input is added to the case-scoped `context.matrix`; reading `context.task.matrix.inputs` is a boundary error.

## Choose stable names and identifiers

An explicit `caseOf` name is under your control. Keep it stable when the scenario is the same, because the generated report `caseId` is derived from the case's position and name.

For `casesFromInputs`, generated names use the prefix plus a one-based position: `<prefix> #1`, `<prefix> #2`, and so on. Inserting or reordering rows changes those generated names and IDs. If reports must compare the same logical sample across changing dataset order, carry a unique identifier in the input and emit it as `benchmark.case.id` as shown above. That value must be unique across every case in each compared report, including cases from other tasks or projects. Duplicate comparison keys are rejected rather than matched ambiguously.

Report selectors can address direct case fields such as `caseName` and `caseId`, scores, or emitted metric names. Default case comparison looks for `benchmark.case.id`, then `vieval.case.id`, and finally the generated `caseId`.

::: warning Keep registration inside the task
`caseOf` and `casesFromInputs` require an active `describeTask` scope. Calling either function outside that scope throws during evaluation-module loading.
:::

The task now defines what runs and which input each case receives. Next, decide what evidence each case should produce in [Assertions, Scores, and Metrics](/en/guide/learn/assertions-scores-and-metrics). For package entrypoints, see the [API overview](/en/api/).

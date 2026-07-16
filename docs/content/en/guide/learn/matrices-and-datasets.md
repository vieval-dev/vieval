---
title: Matrices and Datasets
prev:
  text: Models and Inference Executors
  link: /en/guide/learn/models-and-inference-executors
next:
  text: Reliable Execution
  link: /en/guide/learn/reliable-execution
---

# Matrices and Datasets

Matrices repeat an eval task under selected configuration values. Input arrays repeat its cases. Keeping those two kinds of expansion separate makes the size and meaning of a run easier to predict.

## Start with one model axis

Add a `model` axis to the project `runMatrix`. With one registered alias, it produces one run row:

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'chat-evals',
      root: '.',
      runMatrix: {
        extend: {
          model: ['assistant-default'],
        },
      },
    },
  ],
})
```

Now add a scenario axis. Axis values form a cartesian product, so one model and two scenarios produce two run rows:

```ts [vieval.config.ts]
export default defineConfig({
  projects: [
    {
      name: 'chat-evals',
      runMatrix: {
        extend: {
          model: ['assistant-default'],
          scenario: ['baseline', 'stress'], // [!code ++]
        },
      },
    },
  ],
})
```

Task code receives one selected value per axis under `context.task.matrix.run`. Axis names have no built-in behavior: adding `scenario` schedules rows, but your task must read the value and change behavior if the scenarios should differ.

## Separate run and eval matrices

Use `runMatrix` for variants of the system under evaluation, such as its model, prompt language, or scenario. Use `evalMatrix` for variants of evaluation behavior, such as a rubric name or judge-model selector.

```ts [vieval.config.ts]
export default defineConfig({
  projects: [
    {
      evalMatrix: {
        extend: {
          rubric: ['strict', 'lenient'],
        },
      },
      name: 'chat-evals',
      runMatrix: {
        extend: {
          model: ['assistant-default'],
          scenario: ['baseline', 'stress'],
        },
      },
    },
  ],
})
```

This definition has two run rows and two eval rows, yielding four row pairs for each discovered entry and scheduler inference executor. The selections appear separately as `context.task.matrix.run` and `context.task.matrix.eval`.

The distinction is organizational, not an automatic call pipeline. A `model` axis does not invoke that model, and a `rubric` or judge-model axis does not run a judge. Task or assertion code must read the selected values and implement those actions.

## Layer project, eval, and task matrices

Matrix layers resolve from outer to inner:

1. Project `runMatrix` and `evalMatrix` from `vieval.config.*`.
2. Eval-local `matrix` from `defineEval`.
3. Task-local `matrix` from `defineTask`.

Within every layer, Vieval applies controls in this order:

1. `disable` removes the named axes inherited so far. Its value is an array of axis names.
2. `extend` adds new axes and appends deduplicated values to inherited axes.
3. `override` replaces an axis with exactly the values at that layer.

```ts [evals/layered.eval.ts]
import { defineEval, defineTask } from 'vieval/config'

export default defineEval({
  description: 'Shows matrix layering.',
  matrix: {
    runMatrix: {
      disable: ['scenario'],
      extend: {
        promptLanguage: ['en', 'zh'],
      },
      override: {
        model: ['assistant-default'],
      },
    },
  },
  name: 'layered',
  task: defineTask({
    id: 'layered',
    matrix: {
      evalMatrix: {
        override: {
          rubric: ['strict'],
        },
      },
    },
    run(context) {
      return {
        scores: [{
          kind: 'exact',
          score: context.task.matrix.eval.rubric === 'strict' ? 1 : 0,
        }],
      }
    },
  }),
})
```

Against the previous project config, the eval layer removes `scenario`, adds two `promptLanguage` values, and fixes the model axis. The task layer replaces the two inherited rubric values with `strict`. A flat matrix object is still accepted and normalized as `extend`, but the layered form makes inheritance explicit. Do not mix control keys such as `disable` with axis keys in the same object.

## Add input cases without changing matrix rows

`casesFromInputs` accepts an array that your code already loaded or constructed. It registers one case per item and exposes that item as `matrix.inputs` inside the callback:

```ts [evals/dataset.eval.ts]
import { describeTask, expect } from 'vieval'

const inputs = [
  { expected: 4, left: 2, right: 2 },
  { expected: 7, left: 3, right: 4 },
  { expected: 12, left: 5, right: 7 },
]

describeTask('arithmetic dataset', ({ casesFromInputs }) => {
  casesFromInputs('addition', inputs, ({ matrix }) => {
    const result = matrix.inputs.left + matrix.inputs.right
    expect(result).toBe(matrix.inputs.expected)
  })
})
```

This API does not discover or load a generic external dataset. If rows live in JSON, a database, or another source, load and validate them in your own code, then pass the resulting array to `casesFromInputs`.

The runtime shape is:

```text
Project
  -> discovered Eval entry and its Task
    -> inference executor × run row × eval row
      -> one scheduled task execution
        -> explicit caseOf cases + one case per casesFromInputs item
```

Inputs therefore do not create more scheduler rows. They create cases inside every scheduled task whose task definition registers them.

## Calculate the expansion before running

Before attempts and retries, scheduler cardinality is:

```text
discovered entries × project inference executors × run rows × eval rows
```

If a task registers only one `casesFromInputs` group of `N` items, its baseline case callback count before retries or additional attempts is that task's scheduled executions multiplied by `N`. Other `caseOf` calls or input groups add their own cases.

For example, one entry, the default single scheduler inference executor, two run rows, two eval rows, and three inputs produce four scheduled task executions and twelve case callback executions.

::: warning Watch for combinatorial growth and rate limits
Adding values on any axis multiplies scheduled executions; adding inputs multiplies case work within them. This increases runtime and report records. It increases provider calls, cost, and rate-limit exposure only when the repeated task or case code actually invokes a provider, and one case may make more than one call. Estimate that call count separately and set concurrency to match provider capacity.
:::

Next, control retries, attempts, timeouts, and concurrency in [Reliable Execution](/en/guide/learn/reliable-execution). The [Config reference](/en/config/) and [API reference](/en/api/) list the underlying matrix and task types.

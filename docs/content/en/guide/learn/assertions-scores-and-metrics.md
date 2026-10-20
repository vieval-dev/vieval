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

A case becomes useful evidence when it makes success observable. Start with deterministic assertions, then declare named scores for the qualities you measure, and record metrics for everything else that reports should keep.

## Start with a deterministic assertion

Vieval exports a Vitest-compatible `expect`. A failed matcher throws an `AssertionError` inside the case, so the case ends `failed`: it produced a wrong result.

Any other error, such as a provider rate limit, a dropped connection, or a bug, ends the case `errored`: it produced no result. A timeout ends it `timeout`, which also has no result. These cases lower the **completion rate**, the share of cases that produced a result. Vieval shows the completion rate next to the headline score everywhere, so read the two together: a high score over a low completion rate measured only part of the dataset.

To mark a wrong result, use `expect`. Do not throw a plain `Error`, which reads as "no result". If your test object can crash on hard inputs and a crash should count as a wrong result, set `classifyError` on the task or case:

```ts
import { isRetriableProviderError } from 'vieval/core/inference-executors'

// Only provider failures produce no result; every other error is a wrong result of the test object.
describeTask('read aloud', build, {
  classifyError: error => isRetriableProviderError(error) ? 'errored' : 'failed',
})
```

```ts [evals/normalized-answer.eval.ts]
import { describeTask, expect } from 'vieval'

describeTask('normalized answer', ({ caseOf }) => {
  caseOf('removes surrounding whitespace', () => {
    const answer = '  forty-two  '.trim()
    expect(answer).toBe('forty-two')
  })
})
```

This is the clearest starting point for exact values, schemas, required fields, and other rules that code can decide reliably. A task that records no score has no score: its headline is the share of passed cases, labeled "Passed cases".

## Separate the evidence types

| Term | Meaning in Vieval | Effect on a task case |
| --- | --- | --- |
| Assertion | A check that produces a pass/fail decision. `expect` controls the case by throwing on failure; `vieval/core/assertions` also exposes assertion functions that return structured outcomes. | A thrown matcher fails the case. Core assertion outcomes are not connected to the task DSL automatically. |
| Score | A named value in `0..1` where higher is better, declared with `defineScore` and recorded with `context.recordScore(score, value)`. One score per task is the primary score. | Aggregated per name over the task's cases. A failed case counts as `0` in every score. |
| Completion rate | The built-in share of cases that produced a result: `(passed + failed) / (passed + failed + errored + timeout)`. Skipped cases are left out. | Always reported next to the primary score. An eval cannot turn it off. |
| Metric | Named benchmark data recorded with `context.recordMetric(name, value)`: latency, cost, token counts, categories. Values may be strings, numbers, booleans, `null`, or arrays of those. | Appears in report events and case records, but does not change the case state or any score. |
| Rubric | An assertion whose `judge` callback returns a reason and normalized score, then compares that score with `minScore` (default `0.7`). | Produces an `AssertionOutcome`; the case records its `score` into a score of its choice. |

The `recordScore`, `recordUnscored`, and `recordMetric` methods are available on the case callback context received by `caseOf` and `casesFromInputs`.

## Declare a score

`defineScore(name, metadata)` declares a score once, as `defineMetric` does for metrics. The name is the stable identifier written to reports. `label` and `description` take one string, or one string per BCP 47 locale; the viewer picks the reader's language and falls back to `en`, then to the first entry. Hovering the score in the viewer shows the description.

```ts [evals/retrieval.eval.ts]
import { defineScore, describeTask, expect } from 'vieval'

const recall = defineScore('retrieval.recall', {
  description: {
    'en': 'Share of the expected documents that the retriever returned.',
    'zh-Hans': '检索结果中包含的期望文档所占的比例。',
  },
  label: { 'en': 'Recall', 'zh-Hans': '召回率' },
})

describeTask('retrieval', ({ caseOf }) => {
  caseOf('finds the expected documents', ({ recordMetric, recordScore }) => {
    const expected = new Set(['doc-a', 'doc-b'])
    const retrieved = ['doc-a', 'doc-c']
    const matches = retrieved.filter(id => expected.has(id)).length

    recordScore(recall, matches / expected.size)
    recordMetric('benchmark.case.id', 'retrieval-basic')
    recordMetric('retrieved.count', retrieved.length)

    expect(matches).toBeGreaterThan(0)
  })
}, { scores: [recall] })
```

- The value must be finite and inside `0..1`. Within one case try, the last `recordScore` call per name wins.
- `recordScore` also accepts a bare name, for example `recordScore('retrieval.recall', 0.5)`. The score then has no label or description.
- A definition is announced to the report the first time a case records it. List the task's scores in the `scores` option of `describeTask` to announce them when the task starts. A listed score is known before the first case, and it counts as missing for a passed case that never records it.

## Choose the primary score

Pages, leaderboards, comparisons, and the CLI summary line show one score per task first, with its label next to its value. That is the **primary** score.

- Mark it with `primary: true`. At most one score of a task is primary; a second one throws when it is announced.
- A task with exactly one score uses that score as primary without the flag.
- A task with several scores and none marked primary has no primary score. Its headline falls back to the share of passed cases.
- When the tasks of a run have different primary scores, the run has no run-level headline score. Each task's primary score is listed with its task name, and the completion rate stays as the run headline.

## Combine scores

A derived score is computed from other scores of the same case try. Use it when the headline answers a question that combines several measurements, for example "correct and natural":

```ts [evals/read-aloud.eval.ts]
import { defineScore, describeTask } from 'vieval'

const correct = defineScore('tts.correct', {
  label: { 'en': 'Written back correctly', 'zh-Hans': '听写正确' },
})
const natural = defineScore('tts.natural', {
  description: 'The judge median: natural 1, mixed 0.5, spelled 0.',
  label: { 'en': 'Natural reading', 'zh-Hans': '读法自然' },
})
const pass = defineScore('tts.pass', {
  // A bare input means `atLeast: 1`, so a mixed reading (0.5) does not pass.
  combine: { all: [correct, natural] },
  label: { 'en': 'Pass', 'zh-Hans': '通过' },
  primary: true,
})

describeTask('read aloud', ({ caseOf }) => {
  caseOf('reads a fraction', async ({ recordScore }) => {
    const { listenerScore, readingScore } = await readAloud('1/2')
    recordScore(correct, listenerScore)
    recordScore(natural, readingScore)
    // `pass` is computed when the try settles; recording it throws.
  })
}, { scores: [correct, natural, pass] })
```

`combine` takes one of three forms, so the viewer can show the formula, for example "all of: correct, natural":

| Form | Value |
| --- | --- |
| `{ all: [a, { score: b, atLeast: 0.5 }] }` | `1` when every input reaches its threshold, else `0`. A bare input passes at `1`. `all` is always binary. |
| `{ mean: [a, b] }` | The mean of the inputs. |
| `{ weighted: [{ score: a, weight: 2 }, { score: b, weight: 1 }] }` | The mean weighted by `weight`. Weights are normalized. |

- A derived score must be listed in the `scores` option of `describeTask`, because no case records it.
- When a try settles, the runtime computes every derived score whose inputs were all recorded in that try. If an input is missing, the derived score is missing for that case.
- A case cannot record a derived score; `recordScore` throws.
- When an eval needs another rule, compute the value in the case and record a plain score whose `description` explains the rule.

## How a case state counts

One rule decides how each case counts in each score. The task result, `run-summary.json`, `cases.jsonl`, and the viewer all use it:

| Case state | Every score of the task |
| --- | --- |
| `passed` | The recorded value, or missing when the case did not record it. |
| `failed` | `0`. An assertion failed, so the case measured a wrong result. The recorded values are kept as details, but they are not counted. |
| `errored`, `timeout` | Left out by default (`errors: 'exclude'`). With `errors: 'zero'` the case counts as `0`. |
| `skipped` | Left out. |

Set `errors` per score. `exclude` follows the view that a provider outage is not a result of the test object; the completion rate then shows how many cases were left out. `zero` matches benchmarks that count every error as a wrong answer, for example Harbor and Terminal-Bench:

```ts
const solved = defineScore('bench.solved', { errors: 'zero', primary: true })
```

Each score summary reports `mean` (over the counted cases, or `null`), `n` (cases that counted), and `total` (settled cases that were not skipped). An empty case selection, for example a `--case` filter that matches nothing, returns no scores.

## Record a score the grader could not produce

Sometimes a case runs to the end, but its grader cannot produce a value: the judge's answer cannot be parsed, the grader fails, or the output is empty. That is neither a wrong result nor an execution error. Record it with `recordUnscored`:

```ts
caseOf('reads a fraction', async ({ recordScore, recordUnscored }) => {
  const verdict = await judgeReading(audio)
  if (verdict == null) {
    recordUnscored(natural, 'invalid_response')
    return
  }
  recordScore(natural, verdict.score)
})
```

- `reason` is a string. The viewer shows its own labels for `grader_failed`, `invalid_response`, `no_response`, and `refusal`. Any other string is shown as written.
- An unscored value never counts, whatever `errors` says. It is not `0`, because it says nothing about the test object.
- An unscored record and a value of the same name replace each other in one try. The last call wins.
- A derived score with an unscored input is unscored with the reason `input_unscored`.
- The case state does not change. A passed case with an unscored value stays passed, and the completion rate does not change.
- Each score summary counts unscored values per reason in `unscored`, for example `{ grader_failed: 2 }`. They are part of `total`, not of `n`.

## Explain a value: rationale and grader

A recorded value can say why it has its value, and what produced it. The viewer shows both on the case page, next to the score badge:

```ts
recordScore(natural, median(verdicts.map(verdict => verdict.score)), {
  grader: { id: 'judge', kind: 'model', model: judgeModel.model, reducer: 'median', votes: verdicts.length },
  metadata: { verdicts },
  rationale: verdicts.map(verdict => verdict.reason).join('\n'),
})
```

- `rationale` is a judge's reasoning or the rule that matched.
- `grader` says what produced the value. `kind` is `rule` (deterministic code), `model` (an LLM or another model), `human` (a reviewer), or `external` (another harness's verifier). `id`, `model`, `version`, `votes`, and `reducer` are optional.
- `metadata` holds other details, shown as an object tree.
- Declare the usual grader once on the definition, `defineScore(name, { grader: { kind: 'model', id: 'judge' } })`. A record overrides it, for example when the judge model is a matrix axis.
- A derived score has no grader of its own. The viewer shows the graders of its inputs.
- `grader.id` matches the `role` of the judge's `inference.*` events, so the viewer can link a score to its judge calls.

The grader is part of what a score means. Two runs whose graders differ in `kind`, `model`, or `version` do not measure the same thing, so a comparison of such runs shows a warning on that score.

## Scores versus metrics

A score answers "how good was this case?" with a value in `0..1` where higher is better. Everything else is a metric: ranges, directions, units, counts, and categories belong to metrics.

Latency is a metric, not a score. Give it a direction so that reports know lower is better:

```ts
import { defineMetric } from 'vieval'

const latency = defineMetric('read_aloud.latency', {
  better: 'lower',
  label: { 'en': 'Read-aloud latency', 'zh-Hans': '朗读耗时' },
  unit: 'ms',
})

recordMetric(latency, elapsedMs)
```

Metrics are evidence for filtering, grouping, and diagnosing reports. A metric alone never makes a case pass, fail, or change a score.

## Give metrics a readable name

The viewer shows metric names such as `osworld.model.usage.output_tokens` as they are. Declare the metric once with `defineMetric` to give it a label, a description, a unit, and a direction. Label and description use the same localized shape as scores.

```ts [evals/agent.eval.ts]
import { defineMetric, describeTask } from 'vieval'

const steps = defineMetric('agent.steps', {
  better: 'lower',
  description: {
    'en': 'Tool calls the agent made before it stopped.',
    'zh-Hans': 'agent 停下之前调用工具的次数。',
  },
  label: { 'en': 'Agent steps', 'zh-Hans': 'Agent 步数' },
  unit: 'steps',
})

describeTask('agent', ({ caseOf }) => {
  caseOf('opens settings', async ({ recordMetric }) => {
    const result = await runAgent()
    recordMetric(steps, result.steps.length)
    // Metadata can also be passed inline; it overrides the definition field by field.
    recordMetric('agent.retries', result.retries, { better: 'lower', label: 'Retries' })
  })
})
```

The first value that carries metadata emits a `metric.defined` event for the task; the same metadata is not emitted again, and changed metadata is emitted again. Keep one set of metadata per metric name: the viewer shows the latest one. In the viewer, hovering a metric shows its label, name, description, unit, direction, and the distribution of its values across the task's cases. Scores appear in the same metric panels, before the metrics, always as percentages where higher is better.

`recordArtifact` takes `label` and `description` in the same shape, for example `recordArtifact('final.webp', { contentType: 'image/webp', path, label: { 'en': 'Final screen', 'zh-Hans': '最终画面' } })`.

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

The core assertion pipeline and the task DSL are separate public surfaces. `evaluateAssertions` returns outcomes; it does not call the case context's `recordScore`, `recordMetric`, or `expect`. Bridge an outcome explicitly into the score it measures:

```ts
const concise = defineScore('answer.concise', { grader: { id: 'concise-answer', kind: 'rule' } })

recordScore(concise, outcome.score, { rationale: outcome.reason })
expect(outcome.pass).toBe(true)
```

Decide deliberately whether the outcome also fails the case. Throwing an `AssertionError` (for example through `expect`) makes the case `failed`, so every score of the task counts it as `0`; throwing another error makes it `errored` unless `classifyError` says otherwise.

::: warning Model-backed judging has runtime consequences
If your `judge` callback invokes a model, it needs the relevant provider configuration and credentials and adds latency and cost. Case concurrency can fan out judge requests, so apply limits that match provider capacity. Review the provider's data policy and choose deliberately which case inputs, outputs, judge prompts, reasons, metrics, or events you retain in report artifacts.
:::

A common boundary error is treating a metric as a score or assuming a rubric outcome is wired into the case automatically. Keep the decision, the scores, and the diagnostic metrics separate in the code.

Next, learn how model registrations and runtime adapters fit this flow in [Models and Inference Executors](/en/guide/learn/models-and-inference-executors). The assertion primitives are listed under the public [`vieval/core/assertions` entrypoint](/en/api/).

---
title: 断言、分数与指标
prev:
  text: 任务、用例与输入
  link: /zh-hans/guide/learn/tasks-cases-and-inputs
next:
  text: 模型与推理执行器
  link: /zh-hans/guide/learn/models-and-inference-executors
---

# 断言、分数与指标

评测用例需要明确记录通过或失败，并在必要时补充分数和指标。本节先介绍可由代码直接判断的断言，再说明如何记录取值在 `0..1` 之间的分数和报告指标。

## 从确定性断言开始

Vieval 导出了与 Vitest 兼容的 `expect`。如果匹配失败，`expect` 会抛出错误，当前用例也会随之失败。没有记录自定义分数的用例通过时，会得到 `1` 分的 `exact` 分数；失败时则得到 `0` 分。

::: code-group
```ts [evals/normalized-answer.eval.ts]
import { describeTask, expect } from 'vieval'

describeTask('normalized answer', ({ caseOf }) => {
  caseOf('removes surrounding whitespace', () => {
    const answer = '  forty-two  '.trim()
    expect(answer).toBe('forty-two')
  })
})
```
:::

精确值、数据结构、必需字段，以及其他可以由代码可靠判断的规则，都适合使用 `expect`。

## 选择断言、分数或指标

| 术语 | 在 Vieval 中的含义 | 对任务用例的影响 |
| --- | --- | --- |
| 断言（Assertion） | 检查结果是否满足要求。`expect` 失败时会抛出错误；`vieval/core/assertions` 还提供返回结构化结果的断言函数。 | `expect` 抛出的错误会使当前用例失败。核心断言函数的返回值不会自动写入任务结果。 |
| 分数（Score） | 通过 `context.score(value, kind)` 记录的 `0..1` 数值。分数类型可以是 `exact` 或 `judge`，默认为 `exact`。 | 用例通过时，分数会参与任务结果的汇总；相应事件也会写入报告中的用例记录。 |
| 指标（Metric） | 通过 `context.metric(name, value)` 记录的具名数据。值可以是字符串、数值、布尔值、`null`，或这些值组成的数组。 | 指标会写入报告事件和用例记录，但不会改变用例状态，也不参与分数汇总。 |
| 评分标准（rubric） | 一类核心断言。`judge` 回调返回评分理由和分数，Vieval 再将分数与 `minScore` 比较；默认阈值为 `0.7`。 | 返回一个分数类型为 `judge` 的 `AssertionOutcome`。你需要自行决定如何将它写入当前用例。 |

`caseOf` 和 `casesFromInputs` 收到的用例回调上下文提供 `score` 与 `metric` 方法。

## 在用例中记录分数与指标

需要计入任务平均分的数据应使用 `score`。只用于筛选、分组或排查问题的数据应使用 `metric`。

::: code-group
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
:::

分数必须是 `0..1` 之间的有限数值。在同一个用例中，如果再次记录相同类型的分数，新值会替换旧值。因此，每种分数类型最好只记录一次最终结果。

任务汇总分数和报告中的用例记录并非同时写入。每次调用 `score` 都会立即发出事件，所以用例失败前记录的分数仍可能出现在报告中。

如果用例最终失败或超时，任务汇总会忽略这些自定义分数，并为该用例计入一个 `exact: 0`。用例结束时，只有报告中的用例记录还没有 `exact` 分数，Vieval 才会补写 `exact: 0`。因此，排查结果时应同时检查用例的 `state` 和分数记录。

指标用于筛选、分组和诊断报告。单独记录指标不会让用例通过或失败，也不会提高任务汇总分数。

## 使用评分标准断言

`vieval/core/assertions` 提供 `expectRubric` 和 `evaluateAssertions`。`expectRubric` 用来创建断言；当 `evaluateAssertions` 执行该断言时，它会调用 `judge`，将返回的分数限制在 `0..1` 之间，再用 `minScore` 判断是否通过，最后返回结构化的 `AssertionOutcome`：

::: code-group
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
:::

这个示例只执行本地代码，不会调用模型。`expectRubric` 本身既不选择模型，也不请求模型服务；是否调用模型完全由 `judge` 回调决定。这个回调也可以使用本地规则或人工评分结果。

核心断言 API 与任务 DSL 是两套独立的公开接口。`evaluateAssertions` 只返回断言结果，不会自动调用用例上下文中的 `score`、`metric` 或 `expect`。`toRunScores(outcomes)` 可以把这些结果转换成 `RunScore[]`，但同样不会将分数写入当前用例。

得到 `outcome` 后，你可以调用 `score(outcome.score, outcome.scoreKind)` 记录分数，在 `outcome.pass` 为 `false` 时抛出错误，也可以将评分理由记为指标。选择哪种方式取决于你希望它如何影响用例状态和任务汇总。

如果你通过抛出错误使当前用例失败，任务汇总会为该用例计入 `exact: 0`。抛错前已经发出的分数事件仍可能保留在报告的用例记录中。

::: warning 模型评分会带来运行成本
如果 `judge` 回调调用模型，就需要配置对应的模型服务和凭据，并承担请求延迟和费用。并发运行用例时，可能同时发出多次评分请求，因此应根据服务方的速率限制和配额设置并发上限。还应检查服务方如何处理数据，并决定哪些用例输入、模型输出、评分提示词、评分理由、指标和事件可以写入报告文件。
:::

常见错误包括把指标当成分数，或误以为评分标准断言的结果会自动写入当前用例。编写评测时，应分别处理用例状态、参与汇总的分数，以及用于排查问题的指标。

下一步在[模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors)中学习如何注册并选择模型。所有核心断言 API 都可以从 [`vieval/core/assertions`](/zh-hans/api/) 导入。

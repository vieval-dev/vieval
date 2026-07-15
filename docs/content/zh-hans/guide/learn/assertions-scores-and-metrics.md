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

用例只有把成功与否变成可观察的结果，才能成为有效证据。可以先编写确定性断言，再根据评测需要补充归一化分数或报告元数据。

## 从确定性断言开始

Vieval 导出了与 Vitest 兼容的 `expect`。匹配失败会在用例中抛出错误，从而使该用例失败；没有自定义分数且顺利完成的用例会产生 `1` 分的 `exact` 分数，失败用例则产生 `0` 分。

```ts [evals/normalized-answer.eval.ts]
import { describeTask, expect } from 'vieval'

describeTask('normalized answer', ({ caseOf }) => {
  caseOf('removes surrounding whitespace', () => {
    const answer = '  forty-two  '.trim()
    expect(answer).toBe('forty-two')
  })
})
```

精确值、数据结构、必需字段以及其他能够由代码可靠判断的规则，都适合先用这种方式表达。

## 区分不同类型的证据

| 术语 | 在 Vieval 中的含义 | 对任务用例的影响 |
| --- | --- | --- |
| 断言（Assertion） | 产生通过/失败判断的检查。`expect` 在失败时抛出错误以控制用例状态；`vieval/core/assertions` 还提供返回结构化结果的断言函数。 | 抛出错误的匹配器会使该用例失败。核心断言结果不会自动连接到任务 DSL。 |
| 分数（Score） | 使用 `context.score(value, kind)` 记录的 `0..1` 归一化数值。公开的分数类型为 `exact` 和 `judge`，默认是 `exact`。 | 用例通过时参与任务结果聚合；已经发出的事件也可能保留在报告的用例记录中。 |
| 指标（Metric） | 使用 `context.metric(name, value)` 记录的具名评测元数据。值可以是字符串、数值、布尔值、`null`，或由这些遥测值组成的数组。 | 写入报告事件和用例记录，但不改变通过/失败状态，也不参与分数聚合。 |
| 评分标准（Rubric） | 一种断言：由 `judge` 回调返回理由和归一化分数，再与 `minScore` 比较，默认阈值为 `0.7`。 | 产生分数类型为 `judge` 的 `AssertionOutcome`；作者需要决定怎样把结果连接到任务用例。 |

`caseOf` 和 `casesFromInputs` 收到的用例回调上下文提供 `score` 与 `metric` 方法。

## 在用例中记录分数与指标

需要参与平均值计算的数据应使用 `score`。需要由报告保留、但不代表结果本身的维度或观察值应使用 `metric`。

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

分数必须是 `0..1` 范围内的有限数值。在同一个用例中，再次以相同类型调用 `score` 会替换先前的值，因此每种分数类型应只记录一个最终值。

任务结果聚合与报告用例记录的写入时机不同。如果用例随后失败或超时，任务结果聚合会忽略它的自定义分数，并增加一次 `exact` 失败证据。不过，每次调用 `score` 都会立即发出事件，因此失败前已经发出的分数可能仍会保留在报告用例记录中。用例结束事件只会在记录中尚无 `exact` 分数时补上 `0`。诊断报告时，需要结合用例 `state` 与其中记录的分数一起判断。

指标用于筛选、分组和诊断报告。单独记录指标不会让用例通过或失败，也不会提高聚合分数。

## 有意识地使用 Rubric 断言

公开入口 `vieval/core/assertions` 提供 `expectRubric` 和 `evaluateAssertions`。`expectRubric` 会创建一个断言；该断言在执行时（例如由 `evaluateAssertions` 执行）调用传入的 `judge`，把返回分数限制在 `0..1`，应用 `minScore`，并产生结构化的 `AssertionOutcome`：

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

这个示例采用确定性逻辑，不会调用模型。`expectRubric` 本身不会选择模型，也不会调用模型提供方。`judge` 回调既可以使用本地逻辑或人工结果，也可以调用模型推理。

核心断言管线与任务 DSL 目前是两个独立的公开接口。`evaluateAssertions` 返回结果，但不会自动调用用例回调上下文的 `score`、`metric` 或 `expect`。手动连接结果时，需要明确决定是记录数值分数、根据 `outcome.pass` 使该用例失败、把理由保留为指标，还是组合使用这些方式。通过抛出错误使该用例失败时，任务结果会把该用例视为一次 `exact` 失败；抛出错误前已经发出的分数事件仍可能出现在报告用例记录中。

::: warning 模型评分会带来运行成本
如果 `judge` 回调调用模型，就需要相应的模型提供方配置与凭据，并会增加延迟和费用。用例并发可能同时发出多次评分请求，因此并发上限应与模型提供方容量一致。还应检查提供方的数据处理政策，并明确选择哪些用例输入、输出、评分提示词、理由、指标或事件需要保留在报告制品中。
:::

常见的边界错误包括把指标当成分数，或者认为 Rubric 结果会自动连接到用例。代码中应分别表达判断、数值证据和诊断元数据。

下一步在[模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors)中了解模型注册和运行时适配器怎样接入这条流程。断言原语列在公开的 [`vieval/core/assertions` 入口](/zh-hans/api/)下。

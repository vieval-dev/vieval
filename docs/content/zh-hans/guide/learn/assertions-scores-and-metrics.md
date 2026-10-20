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

评测用例需要明确记录通过或失败，并在必要时补充分数和指标。本节先介绍可由代码直接判断的断言，再说明如何声明具名分数、组合分数，以及如何记录报告指标。

## 从确定性断言开始

Vieval 导出了与 Vitest 兼容的 `expect`。如果匹配失败，`expect` 会抛出 `AssertionError`，当前用例以 `failed` 结束，表示它得出了错误的结果。

其他错误，例如服务限流、连接中断或代码缺陷，会让用例以 `errored` 结束，表示没有得出结果。超时的用例以 `timeout` 结束，同样没有结果。这些用例会降低**执行成功率**（completion rate），即得出结果的用例所占的比例。Vieval 在所有显示主分数的地方都会同时显示执行成功率，阅读时请把两者放在一起看：执行成功率低时，分数只反映了数据集的一部分。

要表示结果错误，请使用 `expect`，不要直接抛出普通的 `Error`，否则会被视为“没有结果”。如果被测对象在困难输入上可能崩溃，而你希望把崩溃算作错误结果，可以在任务或用例上设置 `classifyError`：

```ts
import { isRetriableProviderError } from 'vieval/core/inference-executors'

// 只有服务故障算作没有结果；其他错误都算作被测对象给出了错误结果。
describeTask('read aloud', build, {
  classifyError: error => isRetriableProviderError(error) ? 'errored' : 'failed',
})
```

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

精确值、数据结构、必需字段，以及其他可以由代码可靠判断的规则，都适合使用 `expect`。没有记录任何分数的任务就没有分数，它的标题数值是通过用例的比例，并标注为“通过用例”。

## 选择断言、分数或指标

| 术语 | 在 Vieval 中的含义 | 对任务用例的影响 |
| --- | --- | --- |
| 断言（Assertion） | 检查结果是否满足要求。`expect` 失败时会抛出错误；`vieval/core/assertions` 还提供返回结构化结果的断言函数。 | `expect` 抛出的错误会使当前用例失败。核心断言函数的返回值不会自动写入任务结果。 |
| 分数（Score） | 用 `defineScore` 声明、用 `context.recordScore(score, value)` 记录的具名数值，取值在 `0..1` 之间，越高越好。每个任务有一个主分数。 | 按分数名在任务的所有用例上汇总。失败的用例在每个分数中都按 `0` 计算。 |
| 执行成功率（Completion rate） | 内置的数值，表示得出结果的用例比例：`(passed + failed) / (passed + failed + errored + timeout)`，不计跳过的用例。 | 总是显示在主分数旁边，评测无法关闭它。 |
| 指标（Metric） | 通过 `context.recordMetric(name, value)` 记录的具名数据，例如耗时、费用、token 数、类别。值可以是字符串、数值、布尔值、`null`，或这些值组成的数组。 | 指标会写入报告事件和用例记录，但不会改变用例状态，也不影响任何分数。 |
| 评分标准（rubric） | 一类核心断言。`judge` 回调返回评分理由和分数，Vieval 再将分数与 `minScore` 比较；默认阈值为 `0.7`。 | 返回一个 `AssertionOutcome`。由用例自己决定把它的 `score` 记到哪个分数上。 |

`caseOf` 和 `casesFromInputs` 收到的用例回调上下文提供 `recordScore`、`recordUnscored` 与 `recordMetric` 方法。

## 声明分数

`defineScore(name, metadata)` 用来声明一个分数，用法和 `defineMetric` 一样。`name` 是写入报告的稳定标识。名称（label）和说明（description）可以是一个字符串，也可以按 BCP 47 语言标签各写一份；viewer 会按读者的语言选择，找不到时依次回退到 `en` 和第一项。在 viewer 中把鼠标悬停在分数上，就能看到它的说明。

::: code-group
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
:::

- 分数必须是 `0..1` 之间的有限数值。在同一次用例尝试中，同名分数以最后一次 `recordScore` 为准。
- `recordScore` 也可以直接传分数名，例如 `recordScore('retrieval.recall', 0.5)`，这时分数没有名称和说明。
- 用例第一次记录某个定义时，Vieval 会把它写入报告。也可以在 `describeTask` 的 `scores` 选项中列出任务的分数，让它们在任务开始时就写入报告。列出的分数在第一个用例之前就是已知的；通过的用例如果没有记录它，就算作缺失。

## 选择主分数

页面、排行榜、对比和 CLI 汇总行会优先显示每个任务的一个分数，并在数值旁边显示它的名称。这个分数就是**主分数**（primary）。

- 用 `primary: true` 标记主分数。一个任务最多只有一个主分数，声明第二个时会抛出错误。
- 只有一个分数的任务不需要标记，这个分数就是主分数。
- 有多个分数但都没有标记的任务没有主分数，标题数值会回退为通过用例的比例。
- 如果一次运行中各任务的主分数不同，运行级别就不显示标题分数，而是按任务名分别列出各自的主分数，运行的标题数值只保留执行成功率。

## 组合分数

派生分数由同一次用例尝试中的其他分数计算得出。当标题数值要回答的是几项测量组合起来的问题时，例如“听写正确并且读法自然”，就可以使用派生分数：

::: code-group
```ts [evals/read-aloud.eval.ts]
import { defineScore, describeTask } from 'vieval'

const correct = defineScore('tts.correct', {
  label: { 'en': 'Written back correctly', 'zh-Hans': '听写正确' },
})
const natural = defineScore('tts.natural', {
  description: { 'en': 'The judge median: natural 1, mixed 0.5, spelled 0.', 'zh-Hans': '评委中位数：natural 1，mixed 0.5，spelled 0。' },
  label: { 'en': 'Natural reading', 'zh-Hans': '读法自然' },
})
const pass = defineScore('tts.pass', {
  // 不带阈值的输入相当于 `atLeast: 1`，所以 mixed（0.5）不算通过。
  combine: { all: [correct, natural] },
  label: { 'en': 'Pass', 'zh-Hans': '通过' },
  primary: true,
})

describeTask('read aloud', ({ caseOf }) => {
  caseOf('reads a fraction', async ({ recordScore }) => {
    const { listenerScore, readingScore } = await readAloud('1/2')
    recordScore(correct, listenerScore)
    recordScore(natural, readingScore)
    // `pass` 会在这次尝试结束时自动计算；直接记录它会抛出错误。
  })
}, { scores: [correct, natural, pass] })
```
:::

`combine` 只支持三种形式，这样 viewer 才能显示公式，例如“全部满足：听写正确、读法自然”：

| 形式 | 取值 |
| --- | --- |
| `{ all: [a, { score: b, atLeast: 0.5 }] }` | 每个输入都达到阈值时为 `1`，否则为 `0`。不带阈值的输入要达到 `1` 才算满足。`all` 的结果总是 0 或 1。 |
| `{ mean: [a, b] }` | 各输入的平均值。 |
| `{ weighted: [{ score: a, weight: 2 }, { score: b, weight: 1 }] }` | 按 `weight` 加权的平均值，权重会自动归一化。 |

- 派生分数必须列在 `describeTask` 的 `scores` 选项中，因为没有用例会记录它。
- 每次用例尝试结束时，只要派生分数的所有输入都已记录，运行时就会计算它。缺少任何一个输入时，这个用例的派生分数也是缺失的。
- 用例不能直接记录派生分数，否则 `recordScore` 会抛出错误。
- 如果需要其他计算规则，请在用例里自己算出数值，记录为普通分数，并在 `description` 中写明规则。

## 用例状态如何计入分数

每个用例在每个分数中如何计算，只由一条规则决定。任务结果、`run-summary.json`、`cases.jsonl` 和 viewer 都使用这条规则：

| 用例状态 | 任务的每个分数 |
| --- | --- |
| `passed` | 用例记录的值；没有记录时为缺失。 |
| `failed` | `0`。断言失败，说明用例得出了错误的结果。用例记录过的值会作为详情保留，但不参与计算。 |
| `errored`、`timeout` | 默认不计入（`errors: 'exclude'`）。设置 `errors: 'zero'` 时按 `0` 计算。 |
| `skipped` | 不计入。 |

`errors` 按分数分别设置。`exclude` 的出发点是：服务故障不是被测对象的结果，被排除的用例数量由执行成功率体现。`zero` 适合把每个错误都算作答错的基准测试，例如 Harbor 和 Terminal-Bench：

```ts
const solved = defineScore('bench.solved', { errors: 'zero', primary: true })
```

每个分数的汇总包含 `mean`（计入用例的平均值，没有用例计入时为 `null`）、`n`（计入的用例数）和 `total`（已结束且未跳过的用例数）。如果没有选中任何用例，例如 `--case` 过滤后为空，任务不会返回分数。

## 记录无法评分的情况

有时用例运行完了，评分方却给不出分数：评委的回答无法解析、评分程序出错，或者输出为空。这既不是错误的结果，也不是执行错误。请用 `recordUnscored` 记录：

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

- `reason` 是一个字符串。viewer 会为 `grader_failed`、`invalid_response`、`no_response` 和 `refusal` 显示专门的名称，其他字符串按原样显示。
- 无论 `errors` 如何设置，无法评分的值都不参与计算。它不等于 `0`，因为它没有反映被测对象的任何情况。
- 同一次尝试中，同名的无法评分记录和分数值会互相替换，以最后一次调用为准。
- 派生分数的输入中只要有一个无法评分，派生分数也无法评分，原因为 `input_unscored`。
- 用例状态不变。通过的用例即使有无法评分的值，仍然是通过；执行成功率也不变。
- 每个分数的汇总会在 `unscored` 中按原因统计次数，例如 `{ grader_failed: 2 }`。这些用例计入 `total`，但不计入 `n`。

## 说明分数的来由：理由与评分方

记录分数时，可以说明为什么是这个值，以及由谁给出。viewer 会在用例页面的分数标记旁显示这些信息：

```ts
recordScore(natural, median(verdicts.map(verdict => verdict.score)), {
  grader: { id: 'judge', kind: 'model', model: judgeModel.model, reducer: 'median', votes: verdicts.length },
  metadata: { verdicts },
  rationale: verdicts.map(verdict => verdict.reason).join('\n'),
})
```

- `rationale` 是评委的推理过程，或命中的规则。
- `grader` 说明分数由谁给出。`kind` 可以是 `rule`（确定性代码）、`model`（LLM 或其他模型）、`human`（人工评审）或 `external`（其他评测框架的验证程序）。`id`、`model`、`version`、`votes` 和 `reducer` 都是可选的。
- `metadata` 存放其他详情，以对象树的形式显示。
- 常用的评分方可以在定义里声明一次：`defineScore(name, { grader: { kind: 'model', id: 'judge' } })`。单次记录可以覆盖它，例如评委模型本身是矩阵的一个维度时。
- 派生分数没有自己的评分方，viewer 会显示其输入的评分方。
- `grader.id` 与评委 `inference.*` 事件中的 `role` 一致，viewer 据此把分数和对应的评委调用关联起来。

评分方是分数含义的一部分。如果两次运行的评分方在 `kind`、`model` 或 `version` 上不同，它们测量的就不是同一件事，对比这两次运行时，该分数旁边会显示警告。

## 分数与指标的区别

分数回答的是“这个用例做得有多好”，取值在 `0..1` 之间，越高越好。其他数据都应该记为指标：取值范围、优劣方向、单位、计数和类别都属于指标。

耗时是指标，而不是分数。为它设置方向，报告就知道数值越低越好：

```ts
import { defineMetric } from 'vieval'

const latency = defineMetric('read_aloud.latency', {
  better: 'lower',
  label: { 'en': 'Read-aloud latency', 'zh-Hans': '朗读耗时' },
  unit: 'ms',
})

recordMetric(latency, elapsedMs)
```

指标用于筛选、分组和诊断报告。单独记录指标不会让用例通过或失败，也不会改变任何分数。

## 给指标起一个易读的名字

viewer 会按原样显示 `osworld.model.usage.output_tokens` 这类指标名。用 `defineMetric` 定义一次指标，就可以给它加上名称（label）、说明（description）、单位（unit）和方向（better）。名称和说明的格式与分数相同。

::: code-group
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
    // 也可以在记录时直接传元数据，它会逐个字段覆盖定义里的值。
    recordMetric('agent.retries', result.retries, { better: 'lower', label: '重试次数' })
  })
})
```
:::

第一个带有元数据的值会为当前任务发出一个 `metric.defined` 事件。相同的元数据不会重复发出，元数据变化时会再发一次。每个指标名最好只保留一套元数据，因为 viewer 只显示最新的一套。在 viewer 里，鼠标悬停在指标上，可以看到它的名称、原始指标名、说明、单位、方向，以及它在这个任务所有用例中的取值分布。分数也会出现在同一个指标面板中，排在指标前面，并始终以越高越好的百分比显示。

`recordArtifact` 也接受同样格式的 `label` 和 `description`，例如 `recordArtifact('final.webp', { contentType: 'image/webp', path, label: { 'en': 'Final screen', 'zh-Hans': '最终画面' } })`。

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

核心断言 API 与任务 DSL 是两套独立的公开接口。`evaluateAssertions` 只返回断言结果，不会调用用例上下文中的 `recordScore`、`recordMetric` 或 `expect`。请显式地把结果记到它所测量的分数上：

```ts
const concise = defineScore('answer.concise', { grader: { id: 'concise-answer', kind: 'rule' } })

recordScore(concise, outcome.score, { rationale: outcome.reason })
expect(outcome.pass).toBe(true)
```

是否同时让用例失败，需要你自己决定。抛出 `AssertionError`（例如借助 `expect`）会让用例以 `failed` 结束，任务的每个分数都会把它按 `0` 计算；抛出其他错误时，除非 `classifyError` 另有规定，用例会以 `errored` 结束。

::: warning 模型评分会带来运行成本
如果 `judge` 回调调用模型，就需要配置对应的模型服务和凭据，并承担请求延迟和费用。并发运行用例时，可能同时发出多次评分请求，因此应根据服务方的速率限制和配额设置并发上限。还应检查服务方如何处理数据，并决定哪些用例输入、模型输出、评分提示词、评分理由、指标和事件可以写入报告文件。
:::

常见错误包括把指标当成分数，或误以为评分标准断言的结果会自动写入当前用例。编写评测时，应分别处理用例状态、分数，以及用于排查问题的指标。

下一步在[模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors)中学习如何注册并选择模型。所有核心断言 API 都可以从 [`vieval/core/assertions`](/zh-hans/api/) 导入。

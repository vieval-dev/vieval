---
title: 任务、用例与输入
prev:
  text: 核心概念
  link: /zh-hans/guide/core-concepts
next:
  text: 断言、分数与指标
  link: /zh-hans/guide/learn/assertions-scores-and-metrics
---

# 任务、用例与输入

本节把一项待评测行为整理成包含可重复用例的任务。读完后，你会知道运行时从哪里读取用例输入，以及怎样让数据集中的同一条数据在多份报告之间保持可比较。

## 定义任务边界

`describeTask` 把同一项待评测行为的用例组织在一起，并在加载评测模块时注册任务。任务名称应当在运行矩阵和评测矩阵的不同组合下仍然能够准确描述这项行为。

只有一个具名场景时，可以使用 `caseOf`：

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

传给 `caseOf` 的字符串是便于阅读的用例名称。`input` 选项会成为回调中带类型的 `matrix.inputs` 值。

## 从数据集生成用例

`casesFromInputs` 会为只读数组中的每个元素注册一个用例。回调收到的是完整的数组元素，因此数据集可以同时携带待测数据与稳定标识：

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

这次调用会注册 `addition #1` 和 `addition #2`。`name` 是输入对象自身的属性；`casesFromInputs` 不会用它替换自动生成的用例名称。示例把它记录为 `benchmark.case.id`，报告比较会优先使用该指标作为稳定的匹配键。

## 理解输入的解析位置

用例回调上下文中的 `matrix` 由已解析的任务矩阵与当前用例输入组成：

```text
项目/评测/任务矩阵层
  -> context.task.matrix.run / eval / meta

caseOf(..., { input }) 或 casesFromInputs(...)
  -> context.matrix.inputs
```

在数据集示例中，`matrix.inputs` 是 `inputs` 中的一个对象，因此算术数据位于 `matrix.inputs.input`，数据标识则位于 `matrix.inputs.name`。

`context.task.matrix` 仍然只包含已调度的运行矩阵项、评测矩阵项和元数据。用例输入只会添加到用例范围的 `context.matrix`，这里不能读取 `context.task.matrix.inputs`。

## 选择稳定的名称与标识

`caseOf` 的名称由作者直接控制。同一场景应保持名称稳定，因为报告中的 `caseId` 根据用例位置和名称生成。

`casesFromInputs` 生成的名称由前缀和从 1 开始的位置组成：`<prefix> #1`、`<prefix> #2`，依此类推。插入数据或调整顺序会改变自动生成的名称和 ID。如果多份报告需要在数据顺序变化后继续比较同一个逻辑样本，请在输入中携带唯一标识，并像上例一样记录为 `benchmark.case.id`。该值必须在每一份待比较报告的所有用例中保持唯一，包括其他任务或项目中的用例。比较命令会拒绝重复的匹配键，避免含糊地配对数据。

报告选择器可以读取 `caseName`、`caseId` 等用例字段、分数或已经记录的指标名称。默认的用例比较依次查找 `benchmark.case.id`、`vieval.case.id`，最后才使用自动生成的 `caseId`。

::: warning 在任务范围内注册用例
`caseOf` 和 `casesFromInputs` 需要处于有效的 `describeTask` 范围内。在该范围外调用它们，会在加载评测模块时抛出错误。
:::

任务现在已经确定了要运行什么，以及每个用例会收到哪份输入。下一步在[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)中确定每个用例应当产生哪些证据。包入口可以查阅 [API 概览](/zh-hans/api/)。

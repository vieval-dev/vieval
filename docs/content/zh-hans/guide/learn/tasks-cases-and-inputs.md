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

本节介绍如何用任务组织一组可重复运行的用例。读完后，你将知道如何为单个用例传入数据、如何从数据集批量生成用例，以及如何让不同报告准确匹配同一条数据。

## 创建任务

`describeTask` 用来组织评测同一项功能的用例。Vieval 加载评测文件时，会注册其中声明的任务。任务名称应直接说明要评测什么，并且不应随运行矩阵或评测矩阵的取值变化。

使用 `caseOf` 可以声明一个有名称的用例：

::: code-group
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
:::

`caseOf` 的第一个参数是显示在报告中的用例名称。传入 `input` 选项后，TypeScript 会根据它推导回调中 `matrix.inputs` 的类型。

## 从数据集生成用例

`casesFromInputs` 会为只读数组中的每个元素创建一个用例。回调每次收到一个完整的数组元素，因此可以把待测数据和用于匹配报告的标识放在同一个对象中：

::: code-group
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
:::

这段代码会创建 `addition #1` 和 `addition #2` 两个用例。输入对象中的 `name` 只是普通字段，`casesFromInputs` 不会把它当作用例名称。示例将该字段记录为 `benchmark.case.id`；比较两份报告时，Vieval 会优先用这个指标匹配同一条数据。

## 读取用例输入

用例回调中的 `matrix` 同时包含当前任务的矩阵取值和当前用例的输入：

```text
当前任务的矩阵取值
  -> context.task.matrix.run / eval / meta

caseOf(..., { input }) 或 casesFromInputs(...)
  -> context.matrix.inputs
```

在上面的数据集示例中，`matrix.inputs` 对应 `inputs` 数组中的当前元素。因此，算术数据位于 `matrix.inputs.input`，数据标识位于 `matrix.inputs.name`。

`context.task.matrix` 只保存当前任务在调度时选中的运行矩阵值、评测矩阵值和元数据。Vieval 只把用例输入添加到 `context.matrix.inputs`，因此不要从 `context.task.matrix.inputs` 读取它。

## 选择稳定的名称与标识

你可以直接指定 `caseOf` 的名称。同一个用例应始终使用同一名称，因为报告中的 `caseId` 由用例位置和名称生成。

`casesFromInputs` 按前缀和从 1 开始的序号生成名称：`<prefix> #1`、`<prefix> #2`，依此类推。插入数据或调整顺序都会改变自动生成的名称和 ID。如果数据顺序可能变化，而你仍要比较不同报告中的同一条数据，请为每条输入添加唯一标识，并像上例一样将它记录为 `benchmark.case.id`。

在参与比较的每一份报告中，`benchmark.case.id` 都不能重复，即使这些用例来自不同任务或项目。如果出现重复值，比较命令会报错，而不会自行猜测应该如何配对。

报告选择器可以读取 `caseName`、`caseId` 等用例字段，也可以读取分数和已记录的指标。比较用例时，Vieval 默认依次尝试 `benchmark.case.id`、`vieval.case.id` 和自动生成的 `caseId`。

::: warning 在任务或评测中注册用例
`caseOf` 和 `casesFromInputs` 必须在 `describeTask` 或 `describeEval` 的回调中调用。在其他位置调用时，Vieval 会在加载评测文件时抛出错误。
:::

定义好任务和输入后，下一步是在[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)中记录每个用例的判断结果。完整的导入路径见 [API 概览](/zh-hans/api/)。

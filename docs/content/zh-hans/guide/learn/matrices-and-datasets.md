---
title: 矩阵与数据集
prev:
  text: 模型与推理执行器
  link: /zh-hans/guide/learn/models-and-inference-executors
next:
  text: 可靠执行
  link: /zh-hans/guide/learn/reliable-execution
---

# 矩阵与数据集

矩阵让评测任务在不同配置值下重复执行，输入数组则让任务重复执行其中的用例。区分这两种展开方式，才能更准确地预估一次运行的规模和含义。

## 从一个模型轴开始

先在项目 `runMatrix` 中添加 `model` 轴。只有一个已注册别名时，它会产生一行运行矩阵：

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

接着添加场景轴。各轴的值会组成笛卡尔积，因此一个模型与两个场景会产生两行运行矩阵：

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

任务代码可以从 `context.task.matrix.run` 取得每个轴的一项选中值。轴名没有内置行为：添加 `scenario` 会产生更多调度行；如果不同场景需要不同执行方式，任务必须读取该值并据此处理。

## 区分运行矩阵与评测矩阵

`runMatrix` 适合表示被测系统的变化，例如模型、提示词语言或场景。`evalMatrix` 适合表示评测方式的变化，例如评分标准名称或评分模型选择器。

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

这个定义包含两行运行矩阵和两行评测矩阵，因此会为每个已发现评测项与每个调度推理执行器生成四组矩阵项组合。两类选中值分别位于 `context.task.matrix.run` 和 `context.task.matrix.eval`。

这种区分用于组织配置，并不构成自动调用管线。`model` 轴不会自动调用模型，`rubric` 或评分模型轴也不会自动运行评分逻辑。任务或断言代码必须读取选中值并实现相应操作。

## 分层组合项目、评测与任务矩阵

矩阵从外到内按以下顺序解析：

1. `vieval.config.*` 中项目级的 `runMatrix` 和 `evalMatrix`。
2. `defineEval` 中评测级的 `matrix`。
3. `defineTask` 中任务级的 `matrix`。

在每一层中，Vieval 按以下顺序应用控制项：

1. `disable` 删除此前继承的指定轴，其值是轴名数组。
2. `extend` 添加新轴，并把去重后的值追加到继承轴。
3. `override` 用当前层提供的值完整替换该轴。

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

结合前一段项目配置，评测层会删除 `scenario`，添加两个 `promptLanguage` 值，并固定模型轴。任务层则把继承的两个评分标准值替换为 `strict`。扁平矩阵对象仍可使用，并会被规范化为 `extend`；分层形式能更明确地表达继承关系。同一个对象中不能混合 `disable` 等控制键与普通矩阵轴键。

## 添加输入用例而不增加矩阵行

`casesFromInputs` 接受一组已经由你的代码加载或构造的数组。它为每个元素注册一个用例，并在回调中通过 `matrix.inputs` 提供该元素：

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

这个 API 不会发现或加载通用外部数据集。如果数据位于 JSON、数据库或其他数据源中，需要由你的代码先加载并校验，再把结果数组传给 `casesFromInputs`。

运行结构如下：

```text
项目
  -> 已发现的评测项及其任务
    -> 推理执行器 × 运行矩阵项 × 评测矩阵项
      -> 一次调度任务执行
        -> 显式 caseOf 用例 + casesFromInputs 每个输入对应的一个用例
```

因此，输入不会增加调度器中的矩阵行。它们会在每个注册这些输入的调度任务中生成用例。

## 在运行前计算展开规模

在计算尝试与重试之前，调度数量为：

```text
已发现评测项 × 项目推理执行器 × 运行矩阵行数 × 评测矩阵行数
```

如果任务只注册了一组包含 `N` 个输入的 `casesFromInputs`，那么在重试或追加尝试之前，初始用例回调次数就是该任务的调度执行次数乘以 `N`。其他 `caseOf` 或输入组会分别增加自己的用例。

例如，一个评测项、默认的单个调度推理执行器、两行运行矩阵、两行评测矩阵和三个输入，会产生四次调度任务执行与十二次用例回调执行。

::: warning 注意组合增长与速率限制
任何矩阵轴增加取值都会成倍增加调度执行，增加输入则会增加每次调度任务中的用例工作量。这些变化会增加运行时间和报告记录。只有重复执行的任务或用例代码实际调用模型提供方时，才会增加调用次数、费用和速率限制风险，而且一个用例也可能调用多次。应单独估算调用次数，并根据模型提供方容量设置并发限制。
:::

下一步在[可靠执行](/zh-hans/guide/learn/reliable-execution)中控制重试、尝试、超时和并发。底层矩阵与任务类型见[配置参考](/zh-hans/config/)和 [API 参考](/zh-hans/api/)。

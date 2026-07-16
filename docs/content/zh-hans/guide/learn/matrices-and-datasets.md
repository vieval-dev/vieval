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

`runMatrix` 和 `evalMatrix` 中各维度的取值会组成矩阵组合，每增加一个矩阵组合，就会增加相应的调度任务。`casesFromInputs` 则为数组中的每个输入注册一个用例，因此输入元素会增加每个调度任务中的用例数。

## 从一个模型维度开始

先在项目的 `runMatrix` 中添加 `model` 维度。这里只有一个模型别名，因此运行矩阵只有一种组合：

::: code-group

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

:::

再添加 `scenario`。Vieval 会组合所有维度的取值，因此一个模型和两个场景会产生两种运行矩阵组合：

::: code-group

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

:::

任务可以从 `context.task.matrix.run` 读取本次调度选中的值。维度名称本身不会触发任何操作：`scenario` 只会让调度器创建更多矩阵组合。任务需要自行读取该值，并决定不同场景分别执行什么逻辑。

## 区分运行矩阵与评测矩阵

`runMatrix` 用来区分被测方案，例如模型、提示词语言或运行场景。`evalMatrix` 用来区分评测方法，例如评分标准或评分模型。

::: code-group

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

:::

上面的配置有两种运行矩阵组合和两种评测矩阵组合。Vieval 会为每个「评测项 + 推理执行器」组合创建四个调度任务。任务可以分别从 `context.task.matrix.run` 和 `context.task.matrix.eval` 读取两类配置。

矩阵只负责组合配置，不会自动调用模型或执行评分。即使维度名为 `model` 或 `rubric`，任务和断言仍需读取对应值，并实现模型调用或评分逻辑。

## 按项目、评测和任务三层合并矩阵配置

Vieval 按以下顺序合并矩阵配置：

1. `vieval.config.*` 中项目级的 `runMatrix` 和 `evalMatrix`。
2. `defineEval` 中评测级的 `matrix`。
3. `defineTask` 中任务级的 `matrix`。

每一层内部再按以下顺序处理：

1. `disable` 删除从外层继承的指定维度；它的值是维度名称数组。
2. `extend` 添加新维度，或向已有维度追加值；重复值会被删除。
3. `override` 用当前层给出的值替换整个维度。

::: code-group

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

:::

在前一节项目配置的基础上，评测级配置会删除 `scenario`，添加 `en` 和 `zh` 两种 `promptLanguage`，并把 `model` 替换为 `assistant-default`。任务级配置再把 `rubric` 替换为 `strict`。

项目配置中的 `runMatrix` 和 `evalMatrix` 可以直接写成扁平的矩阵对象，Vieval 会把它们当作 `extend` 处理。`defineEval` 的评测级矩阵和 `defineTask` 的任务级矩阵只接受分层形式，需要通过 `extend`、`override` 或 `disable` 调整继承的配置。不要在同一个对象中混写这些控制项和普通维度名称，否则配置会报错。

## 添加输入用例而不增加矩阵组合

`casesFromInputs` 接受一个由你的代码加载或构造的数组。它为每个元素注册一个用例，并在回调中通过 `matrix.inputs` 提供当前元素：

::: code-group

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

:::

这个 API 不会自行读取外部数据集。数据来自 JSON、数据库或其他来源时，请先在评测代码中加载并校验，再把得到的数组传给 `casesFromInputs`。

运行结构如下：

```text
项目
  -> 已发现的评测项及其任务
    -> 推理执行器 × 运行矩阵组合 × 评测矩阵组合
      -> 一次调度任务执行
        -> 通过 caseOf 注册的用例 + casesFromInputs 为每个输入注册的用例
```

输入元素不会增加矩阵组合或调度任务。每个已经创建的调度任务都会为这些元素分别运行一个用例。

## 在运行前计算展开规模

矩阵展开后，调度任务数为：

```text
已发现评测项 × 项目推理执行器 × 运行矩阵组合数 × 评测矩阵组合数
```

如果任务只调用了一次 `casesFromInputs`，并传入 `N` 个元素，那么首次执行的用例回调次数就是调度任务数乘以 `N`。任务中每增加一次 `caseOf` 调用或另一处 `casesFromInputs` 调用，还会相应增加用例数。

`autoAttempt` 和 `autoRetry` 不会创建新的调度任务。它们只会在已有的调度任务中再次执行用例回调，因此需要另行计算增加的执行次数。

例如，一个评测项使用一个推理执行器、两种运行矩阵组合、两种评测矩阵组合和三个输入时，会创建四个调度任务，并首次执行十二次用例回调。

::: warning 注意组合增长与速率限制
为矩阵维度增加取值会增加矩阵组合；增加输入则会增加每个调度任务中的用例。两者都会延长运行时间，并增加报告中的记录数。只有任务或用例代码实际调用模型服务时，调用次数和费用才会随之增加；一个用例也可能发起多次调用。请按实际调用次数估算费用，并根据服务方的限流规则设置并发数。
:::

下一步可在[可靠执行](/zh-hans/guide/learn/reliable-execution)中设置重试、自动尝试、超时和并发。矩阵与任务的完整类型见[配置参考](/zh-hans/config/)和[API 参考](/zh-hans/api/)。

---
title: 模型与推理执行器
prev:
  text: 断言、分数与指标
  link: /zh-hans/guide/learn/assertions-scores-and-metrics
next:
  text: 矩阵与数据集
  link: /zh-hans/guide/learn/matrices-and-datasets
---

# 模型与推理执行器

模型注册让评测代码可以通过稳定名称取得运行配置，但不会因此发出请求。本节沿着这条边界，说明模型别名怎样关联到最终调用远程或本地推理运行时的代码。

## 注册带提供方配置的模型

内置聊天模型插件会把每个 `chatModelFrom` 结果转换为已配置的 `ModelDefinition`。下面的注册通过 `loadEnv` 读取 `.env` 文件，并在插件解析模型时要求提供 `OPENAI_API_KEY`：

```ts [vieval.config.ts]
import { cwd } from 'node:process'

import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval' // [!code ++]
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models' // [!code ++]

export default defineConfig({
  env: loadEnv('test', cwd(), ''), // [!code ++]
  plugins: [
    ChatModels({ // [!code ++]
      models: [
        chatModelFrom({
          aliases: ['assistant-default'],
          apiKey: config => requiredEnvFrom(config.env, { // [!code ++]
            name: 'OPENAI_API_KEY', // [!code ++]
            type: 'string', // [!code ++]
          }), // [!code ++]
          inferenceExecutor: 'openai',
          model: 'gpt-4.1-mini',
        }),
      ],
    }),
  ],
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

如果没有显式传入 `id`，`chatModelFrom` 会生成模型 ID `openai:gpt-4.1-mini`。它同时保留模型提供方使用的具体模型名，并添加别名 `assistant-default`。随后，`ChatModels` 把解析后的定义追加到配置的 `models` 集合。

::: warning 凭据
不要把 `OPENAI_API_KEY` 提交到版本控制中。`requiredEnvFrom` 会拒绝缺失的值，但不会替你获取、轮换或遮盖凭据。不要把解析后的模型参数写入指标、日志或报告事件。
:::

::: tip 在矩阵轴中使用稳定别名
`modelFromRun` 可以按已注册模型的 ID、具体模型名或别名进行匹配。使用 `assistant-default` 这类面向角色的别名，可以在替换具体模型后保持评测选择不变。
:::

## 区分两类执行器概念

几个名称相近的字段分别位于不同边界：

| 值 | 职责 |
| --- | --- |
| `model.inferenceExecutor` | 由模型插件管理的执行器元数据。内置聊天模型可使用 `'openai'`、`'openrouter'`、`'ollama'` 或兼容的执行器对象；核心配置把它视为不透明数据。 |
| `model.inferenceExecutorId` | 该模型定义的运行配置判别值。执行器是字符串时，`chatModelFrom` 会据此生成该字段；运行配置辅助函数用它选择 OpenAI、OpenRouter 或 Ollama 配置结构。报告结果中的 `inferenceExecutorId` 则来自调度任务的 `context.task.inferenceExecutor.id`。 |
| `projects[].inferenceExecutors` | 独立的调度目标列表。每个已发现评测项都会按其中每个元素展开一次，默认值为 `[{ id: 'default' }]`。它不会从 `models` 推导。 |
| `context.task.inferenceExecutor` | 当前调度任务从 `projects[].inferenceExecutors` 中选中的调度目标。它不必等于矩阵所选模型的执行器元数据。 |

模型解析路径如下：

```text
矩阵别名
  -> 已注册的 ModelDefinition
  -> model.inferenceExecutorId 选择运行配置结构
  -> 评测或 Agent 代码创建并调用远程/本地运行时
```

调度展开则单独通过 `projects[].inferenceExecutors` 完成。只有你自己的执行器设计要求两者关联时，才需要让两处 ID 保持相同；Vieval 不会自动连接它们。

## 在评测代码中解析所选模型

`modelFromRun` 从 `context.task.matrix.run` 读取指定矩阵轴，再用选中值查找 `context.models`。`modelFromEval` 对 `context.task.matrix.eval` 执行相同操作，适合处理选择评分模型或评测模型的评测矩阵轴。

```ts [evals/model-selection.eval.ts]
import { describeTask, expect } from 'vieval'
import { modelFromRun, openaiFromRunContext } from 'vieval/plugins/chat-models'

describeTask('model selection', ({ caseOf }) => {
  caseOf('resolves the run model', (context) => {
    const selectedModel = modelFromRun(context, { axis: 'model' })
    const runtimeConfig = openaiFromRunContext(selectedModel)

    expect(selectedModel.aliases).toContain('assistant-default')
    expect(runtimeConfig.model).toBe('gpt-4.1-mini')
  })
})
```

轴名需要显式指定：`{ axis: 'model' }` 表示读取 `context.task.matrix.run.model`。对于 `judgeModel` 这类评测矩阵轴，应使用 `modelFromEval(context, { axis: 'judgeModel' })`。

`openaiFromRunContext` 会校验并返回 `apiKey`、`model` 等模型提供方参数，但仍不会创建客户端或调用 OpenAI。任务或导入的 Agent 需要把这些配置传给选定的运行时，再显式发起调用。同样，`ChatModels` 只注册和解析元数据，不是模型提供方客户端。

::: warning 费用与数据
注册和解析只涉及本地配置工作。只有任务、Agent 或评分逻辑调用远程模型提供方时，才会产生费用、延迟、速率限制占用和数据传输。启用调用前，应检查哪些提示词、输入、输出、遥测信息和报告制品可能包含敏感数据。只有不使用外部代理或遥测服务的完全本地部署，才不会把推理输入发送给远程模型提供方；本地计算、存储及其他网络策略仍然适用。
:::

下一步在[矩阵与数据集](/zh-hans/guide/learn/matrices-and-datasets)中使用该别名构造可控的组合。配置结构见[配置参考](/zh-hans/config/)，导出的辅助函数见 [API 参考](/zh-hans/api/)。

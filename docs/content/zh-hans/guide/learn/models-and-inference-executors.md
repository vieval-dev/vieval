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

注册模型后，评测代码可以通过固定的名称查找模型配置。注册和查找都不会发出推理请求；只有评测代码或智能体显式发起模型请求，才会访问远程或本地模型服务。本节将依次说明如何注册模型、选择模型，以及获取调用模型所需的配置。

## 注册带提供方配置的模型

内置聊天模型插件会把每次调用 `chatModelFrom` 返回的模型定义添加到配置的 `models` 列表。下面的配置通过 `loadEnv` 读取 `.env` 文件；插件处理模型配置时，`requiredEnvFrom` 会检查 `OPENAI_API_KEY` 是否存在：

::: code-group
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
:::

如果没有传入 `id`，`chatModelFrom` 会根据执行器 ID 和具体模型名生成 `openai:gpt-4.1-mini`。这个模型也可以通过别名 `assistant-default` 查找。

::: warning 凭据
不要把 `OPENAI_API_KEY` 提交到版本控制中。`requiredEnvFrom` 只负责检查环境变量，不能替你生成、轮换或保护密钥。也不要将处理后的模型参数写入指标、日志或报告事件，因为其中可能包含凭据。
:::

::: tip 在矩阵轴中使用稳定别名
`modelFromRun` 可以通过已注册模型的 ID、具体模型名或别名查找模型。矩阵中使用 `assistant-default` 这类表示用途的别名后，更换具体模型时无需同时修改矩阵轴中的模型名称。
:::

## 区分模型配置与调度配置

`ChatModels` 将模型定义加入 Vieval 配置。需要让多个模型共用服务地址、凭据或其他参数时，可以通过 `ChatProviders` 注册一份提供方配置，再让模型通过 `provider` 引用它。

Vieval 会按照 `plugins` 数组中的顺序处理插件。`ChatProviders` 必须写在引用该提供方的 `ChatModels` 前面，否则处理模型配置时会抛出 `Unknown chat provider` 错误：

::: code-group
```ts [vieval.config.ts]
import { defineConfig } from 'vieval'
import {
  chatModelFrom,
  ChatModels,
  chatProviderFrom,
  ChatProviders,
} from 'vieval/plugins/chat-models'

export default defineConfig({
  plugins: [
    ChatProviders({
      providers: [
        chatProviderFrom({
          id: 'openai-default',
          inferenceExecutor: 'openai',
          requiredEnv: {
            apiKey: 'OPENAI_API_KEY',
          },
        }),
      ],
    }),
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['assistant-default'],
          model: 'gpt-4.1-mini',
          provider: 'openai-default',
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'chat-evals',
      root: '.',
    },
  ],
})
```
:::

`requiredEnv` 的键是要写入模型参数的名称，值是环境变量名。以上配置会读取 `OPENAI_API_KEY`，并将它作为 `apiKey` 参数加入提供方配置。以下字段名称相近，但用途不同：

| 值 | 职责 |
| --- | --- |
| `model.provider` | 指向 `ChatProviders` 中注册的提供方 ID。插件处理配置时，会将提供方的执行器和参数合并到模型定义中；模型自身的参数优先。 |
| `model.inferenceExecutor` | 模型定义中的执行器配置。内置聊天模型可以使用 `'openai'`、`'openrouter'`、`'ollama'`，也可以传入兼容的执行器对象。Vieval 核心不会解释这个字段。 |
| `model.inferenceExecutorId` | 标识该模型使用哪类运行配置。执行器是字符串时，`chatModelFrom` 会用它生成此字段；`openaiFromRunContext` 等辅助函数则根据它校验并返回对应的配置结构。模型定义中的 `inferenceExecutorId` 与报告里的同名字段来源不同：报告字段来自当前调度任务的 `context.task.inferenceExecutor.id`。 |
| `projects[].inferenceExecutors` | 项目要调度的执行目标列表。每个发现的评测项都会针对列表中的每一项运行一次；默认值是 `[{ id: 'default' }]`。Vieval 不会根据 `models` 自动生成这个列表。 |
| `context.task.inferenceExecutor` | 当前任务从 `projects[].inferenceExecutors` 中选中的执行目标。它不一定与矩阵所选模型中的执行器配置相同。 |

评测代码按以下步骤取得模型配置：

```text
矩阵别名
  -> 已注册的 ModelDefinition
  -> 根据 model.inferenceExecutorId 校验运行配置
  -> 评测代码或智能体使用该配置调用远程/本地模型
```

`projects[].inferenceExecutors` 单独控制调度次数。Vieval 不会自动把其中的 ID 与模型的 `inferenceExecutorId` 视为同一个值。只有你的执行代码依赖这种对应关系时，才需要让两处 ID 保持一致。

## 在评测代码中查找所选模型

`modelFromRun` 读取 `context.task.matrix.run` 中指定轴的值，再根据这个值查找 `context.models`。`modelFromEval` 则读取 `context.task.matrix.eval`，适合查找评分模型或其他只用于评测的模型。

::: code-group
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
:::

调用时必须指定轴名。`{ axis: 'model' }` 表示读取 `context.task.matrix.run.model`；如果模型名称位于 `judgeModel` 这样的评测矩阵轴中，则应使用 `modelFromEval(context, { axis: 'judgeModel' })`。

`openaiFromRunContext` 会校验模型定义，并返回 `apiKey`、`model` 等 OpenAI 调用参数。它不会创建客户端，也不会调用 OpenAI。任务代码或它调用的智能体还需要把这些参数交给所选的模型调用库或运行时，并显式发起请求。`ChatModels` 同样只负责登记和处理模型配置，不是模型服务客户端。

::: warning 费用与数据
注册和查找模型只会处理本地配置。任务、智能体或评分代码发起远程请求后，会产生调用费用和网络延迟，还可能受到服务方的速率限制，并向外部服务传输数据。启用远程调用前，应检查提示词、输入、输出、遥测数据和报告文件中是否含有敏感信息。

如果需要让推理输入完全留在本地，应使用本地模型，并确认执行过程中没有经过外部代理或遥测服务。本地推理仍会占用计算和存储资源，也仍需遵守项目自身的网络和数据管理要求。
:::

下一步将在[矩阵与数据集](/zh-hans/guide/learn/matrices-and-datasets)中使用模型别名生成多组评测组合。完整配置见[配置参考](/zh-hans/config/)，可导入的辅助函数见 [API 参考](/zh-hans/api/)。

---
title: Models and Inference Executors
prev:
  text: Assertions, Scores, and Metrics
  link: /en/guide/learn/assertions-scores-and-metrics
next:
  text: Matrices and Datasets
  link: /en/guide/learn/matrices-and-datasets
---

# Models and Inference Executors

A model registration gives eval code a stable name for runtime configuration. It does not send a request. This lesson follows that boundary from a model alias to the code that can make a remote or local inference call.

## Register a provider-backed model

The built-in chat-model plugin turns each `chatModelFrom` result into a configured `ModelDefinition`. The following registration reads `.env` files through `loadEnv` and requires `OPENAI_API_KEY` while the plugin resolves the model:

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

`chatModelFrom` derives the model id `openai:gpt-4.1-mini` unless you provide `id`. It preserves the concrete provider model name and adds `assistant-default` as an alias. `ChatModels` then appends the resolved definition to the config's `models` collection.

::: warning Credentials
Keep `OPENAI_API_KEY` outside source control. `requiredEnvFrom` rejects a missing value; it does not obtain, rotate, or redact the credential for you. Be careful not to emit the resolved model parameters into metrics, logs, or report events.
:::

::: tip Prefer stable aliases in matrix axes
`modelFromRun` can match a registered model by id, concrete model name, or alias. A role-oriented alias such as `assistant-default` lets eval selection stay stable when the concrete model changes.
:::

## Keep the two executor concepts separate

Several similarly named fields serve different boundaries:

| Value | Responsibility |
| --- | --- |
| `model.inferenceExecutor` | Executor metadata owned by the model plugin. For the built-in chat model it may be `'openai'`, `'openrouter'`, `'ollama'`, or a compatible executor object. Core config treats it as opaque. |
| `model.inferenceExecutorId` | Runtime-config discriminator for that model definition. `chatModelFrom` derives it from a string executor; runtime config helpers use it to select the OpenAI, OpenRouter, or Ollama shape. Report results instead take their `inferenceExecutorId` from the scheduled `context.task.inferenceExecutor.id`. |
| `projects[].inferenceExecutors` | An independent list of scheduler targets. Every discovered entry is expanded once per item; its default is `[{ id: 'default' }]`. It is not derived from `models`. |
| `context.task.inferenceExecutor` | The scheduler target selected from `projects[].inferenceExecutors` for this scheduled task. It need not equal the executor metadata of a matrix-selected model. |

The model path is therefore:

```text
matrix alias
  -> registered ModelDefinition
  -> model.inferenceExecutorId selects a runtime-config shape
  -> eval or agent code creates and calls the remote/local runtime
```

Scheduler fan-out is a separate path through `projects[].inferenceExecutors`. Give the two ids the same value only when your own executor design requires that relationship; Vieval does not join them automatically.

## Resolve the selected model in eval code

`modelFromRun` reads the named axis from `context.task.matrix.run`, then resolves its selected value against `context.models`. `modelFromEval` does the same under `context.task.matrix.eval`, which is useful when an eval axis selects a judge or evaluator model.

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

The axis name is explicit: `{ axis: 'model' }` means “read `context.task.matrix.run.model`.” For an eval-matrix axis such as `judgeModel`, use `modelFromEval(context, { axis: 'judgeModel' })`.

`openaiFromRunContext` validates and returns provider options such as `apiKey` and `model`. It still does not create a client or call OpenAI. The task or imported agent must pass that configuration to its chosen runtime and invoke it. Likewise, `ChatModels` registers and resolves metadata; it is not a provider client.

::: warning Cost and data
Registration and resolution are local configuration work. Cost, latency, rate-limit use, and data transfer begin only when your task, agent, or judge invokes a remote provider. Review which prompts, inputs, outputs, telemetry, and report artifacts may contain sensitive data before enabling such calls. Only a fully local deployment without an external proxy or telemetry avoids sending inference input to a remote model provider; local compute, storage, and other networking policies still apply.
:::

Next, use the alias across controlled combinations in [Matrices and Datasets](/en/guide/learn/matrices-and-datasets). See the [Config reference](/en/config/) for configuration structure and the [API reference](/en/api/) for exported helpers.

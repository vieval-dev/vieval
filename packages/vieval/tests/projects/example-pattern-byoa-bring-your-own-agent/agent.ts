import type { TaskRunContext } from '../../../src/config'

import process from 'node:process'

import { merge } from '@moeru/std'
import { generateText } from '@xsai/generate-text'

import { createOpenAIFromEnv, normalizeOpenAITextOutput } from '../../../src/core/inference-executors/remote-providers/openai/index'
import { emitChatModelErrorTelemetry, emitChatModelRequestTelemetry, emitChatModelResponseTelemetry } from '../../../src/plugins/chat-models'

/**
 * Runs the minimal fixture agent with model settings resolved from task context.
 *
 * Use when:
 * - eval tasks need to exercise a real model call against configured inferenceExecutors
 * - task execution should import agent logic instead of embedding it in config
 */
export async function runMinimalAgent(context: TaskRunContext): Promise<number> {
  const taskModel = context.model()

  const taskInferenceExecutor = taskModel.inferenceExecutor
  if (taskInferenceExecutor !== 'openai') {
    throw new Error(`Unsupported inferenceExecutor "${String(taskInferenceExecutor)}" in example-pattern-byoa-bring-your-own-agent fixture.`)
  }

  const inferenceExecutorRuntime = createOpenAIFromEnv({ env: merge(process.env) }, { model: taskModel.model })

  const messages: Array<{ content: string, role: 'system' | 'user' }> = [
    { role: 'system', content: 'You are a concise chess companion. Keep output under 8 words.' },
    { role: 'user', content: `Scenario "${context.task.entry.name}": react in one short line.` },
  ]

  emitChatModelRequestTelemetry(context, {
    data: {
      max_tokens: 32,
      messagesCount: messages.length,
    },
    provider: {
      id: 'openai',
      model: taskModel.model,
    },
  })

  try {
    const startedAt = Date.now()
    const response = await inferenceExecutorRuntime.adapter.runWithRetry(async () => {
      return await generateText({
        ...inferenceExecutorRuntime.adapter.provider.chat(inferenceExecutorRuntime.model),
        messages,
        max_tokens: 32,
      })
    })

    const latencyMs = Date.now() - startedAt

    emitChatModelResponseTelemetry(context, {
      latencyMs,
      provider: {
        id: 'openai',
        model: taskModel.model,
      },
      response,
    })

    const responseText = normalizeOpenAITextOutput(response)
    return responseText.trim().length > 0 ? 1 : 0
  }
  catch (error) {
    emitChatModelErrorTelemetry(context, {
      error,
      provider: {
        id: 'openai',
        model: taskModel.model,
      },
    })
    throw error
  }
}

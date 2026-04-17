import type { LoCoMoRetrieverAdapter } from '../contracts.ts'

import process from 'node:process'

import { readFile } from 'node:fs/promises'

import { loadEnv } from 'vite'

import { createXsaiLoCoMoAnswerGenerator } from '../adapters/xsai-answer-generator.ts'
import { evaluateLoCoMoCases } from '../pipeline/evaluate-locomo.ts'
import { deriveLoCoMoCases, loadLoCoMoSamplesFromSnapDataset } from './derive-cases.ts'

interface LoCoMoConversationTurn {
  blip_caption?: string
  speaker: string
  text: string
}

interface LoCoMoConversationRecord extends Record<string, unknown> {
  session_1?: LoCoMoConversationTurn[]
}

interface LoCoMoSampleWithConversation {
  conversation: LoCoMoConversationRecord
  qa: Array<{
    answer: number | string
    category: 1 | 2 | 3 | 4 | 5
    question: string
  }>
  sample_id: string
}

/**
 * Builds LoCoMo conversation text context with date/session separators.
 *
 * Before:
 * - structured session keys and turn arrays
 *
 * After:
 * - plain prompt context including `DATE:` and `CONVERSATION:`
 */
function buildConversationContext(conversation: LoCoMoConversationRecord): string {
  const sessionNumbers = Object.keys(conversation)
    .filter(key => /^session_\d+$/.test(key))
    .map(key => Number(key.split('_')[1]))
    .sort((a, b) => a - b)

  let contextText = ''
  for (const sessionNumber of sessionNumbers) {
    const dateKey = `session_${sessionNumber}_date_time`
    const turnsKey = `session_${sessionNumber}`
    const date = String(conversation[dateKey] ?? '')
    const turns = (conversation[turnsKey] ?? []) as LoCoMoConversationTurn[]

    contextText += `\nDATE: ${date}\nCONVERSATION:\n`
    for (const turn of turns) {
      // Python parity:
      // Conversation line formatting follows
      // `snap-research/locomo/task_eval/gpt_utils.py:183-186`
      // and session framing in `gpt_utils.py:188-196`.
      contextText += `${turn.speaker} said, "${turn.text}"\n`
      if (turn.blip_caption != null && turn.blip_caption.length > 0) {
        contextText += `and shared ${turn.blip_caption}.\n`
      }
    }
  }

  return contextText
}

function buildSampleToContextMap(rawSamples: readonly LoCoMoSampleWithConversation[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const sample of rawSamples) {
    const sessionOne = sample.conversation.session_1
    if (sessionOne == null || sessionOne.length < 2) {
      continue
    }

    const speakerA = sessionOne[0].speaker
    const speakerB = sessionOne[1].speaker
    // Python parity:
    // Prefix text is aligned with `CONV_START_PROMPT` from
    // `snap-research/locomo/task_eval/gpt_utils.py:51-52`
    // (also same wording in `claude_utils.py:42`, `gemini_utils.py:39`).
    const preface = `Below is a conversation between two people: ${speakerA} and ${speakerB}. The conversation takes place over multiple days and the date of each conversation is written at the beginning of the conversation.`
    map.set(sample.sample_id, `${preface}\n\n${buildConversationContext(sample.conversation)}`)
  }
  return map
}

/**
 * Executes a live LoCoMo QA run over the first dataset samples with xsAI.
 *
 * Call stack:
 *
 * runSnapLiveQa (this module)
 *   -> {@link deriveLoCoMoCases}
 *   -> {@link evaluateLoCoMoCases}
 */
async function runSnapLiveQa(): Promise<void> {
  const loadedEnv = loadEnv('test', process.cwd(), '')
  for (const [key, value] of Object.entries(loadedEnv)) {
    process.env[key] ??= value
  }

  const dataFile = process.env.LOCOMO_DATA_FILE ?? '/Users/neko/Git/github.com/snap-research/locomo/data/locomo10.json'
  const maxSamples = Number(process.env.LOCOMO_MAX_SAMPLES ?? '1')
  const maxQuestions = Number(process.env.LOCOMO_MAX_QUESTIONS ?? '5')
  const concurrency = Number(process.env.LOCOMO_EVAL_CONCURRENCY ?? '4')
  const topK = Number(process.env.LOCOMO_TOP_K ?? '10')

  const normalizedSamples = await loadLoCoMoSamplesFromSnapDataset({ dataFile, maxSamples })
  const allCases = deriveLoCoMoCases(normalizedSamples)
  const selectedCases = allCases.slice(0, maxQuestions * maxSamples)

  const rawData = await readFile(dataFile, 'utf8')
  const rawSamples = JSON.parse(rawData) as LoCoMoSampleWithConversation[]
  const limitedRawSamples = rawSamples.slice(0, maxSamples)
  const contextBySampleId = buildSampleToContextMap(limitedRawSamples)

  const oracleRetriever: LoCoMoRetrieverAdapter = {
    id: 'snap-live-oracle-context-retriever',
    async retrieveContext(input) {
      const contextText = contextBySampleId.get(input.sampleId)
      if (contextText == null) {
        throw new Error(`No conversation context found for sample ${input.sampleId}`)
      }
      return {
        contextIds: [],
        contextText,
      }
    },
  }

  const generator = createXsaiLoCoMoAnswerGenerator()
  const evaluation = await evaluateLoCoMoCases({
    cases: selectedCases,
    concurrency,
    generator,
    retriever: oracleRetriever,
    topK,
  })

  for (const [recordIndex, record] of evaluation.records.entries()) {
    console.info(JSON.stringify({
      caseId: record.caseId,
      category: record.category,
      gold: record.goldAnswer,
      prediction: record.prediction,
      qaIndex: recordIndex + 1,
      question: record.question,
      sampleId: record.sampleId,
      score: Number(record.score.toFixed(4)),
    }, null, 2))
  }

  console.info(JSON.stringify({
    byCategory: evaluation.summary.byCategory,
    overallAverageScore: evaluation.summary.overallAverageScore,
    totalCases: evaluation.summary.totalCases,
  }, null, 2))
}

runSnapLiveQa().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

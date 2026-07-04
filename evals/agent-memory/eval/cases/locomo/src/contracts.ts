import type { LoCoMoCategory } from './types'

/**
 * Adapter for agents that answer the final formatted LoCoMo question themselves.
 */
export interface LoCoMoAnswerAgentAdapter {
  answerCase: (input: {
    caseId: string
    category: LoCoMoCategory
    question: string
    rawQuestion: string
    sampleId: string
  }) => Promise<LoCoMoAnswerAgentResult>
  id: string
}

/**
 * Diagnostics returned by an agent that answers a LoCoMo case directly.
 */
export interface LoCoMoAnswerAgentDiagnostics {
  finalMessageId?: string
  memorySearches?: Array<{
    apiName?: string
    arguments?: unknown
    contextIdCount?: number
    contextIds?: string[]
    layerCounts?: Record<string, number>
  }>
  memoryToolCallCount?: number
  operationId?: string
  status?: string
  steps?: number
  toolCallCount?: number
}

/**
 * Direct answer-agent output for one LoCoMo case.
 */
export interface LoCoMoAnswerAgentResult {
  contextIds?: string[]
  diagnostics?: LoCoMoAnswerAgentDiagnostics
  prediction: string
}

export interface LoCoMoAnswerGeneratorAdapter {
  generateAnswer: (input: {
    caseId: string
    category: LoCoMoCategory
    contextText: string
    question: string
    sampleId: string
  }) => Promise<string>
  id: string
}

/**
 * Backend retrieval diagnostics attached to one LoCoMo case.
 *
 * @param retrievedLayerCounts Per-backend-layer raw retrieval counts before answer generation.
 * @param searchedLayerCounts Backend-reported search counts before final item shaping.
 */
export interface LoCoMoRetrievalDiagnostics {
  /**
   * Number of final context items used by the answer generator.
   */
  itemCount?: number
  /**
   * Number of user memory records joined from raw search results.
   */
  joinedMemoryCount?: number
  /**
   * Sum of raw retrieved records across all reported backend layers.
   */
  retrievedContextCount?: number
  /**
   * Raw retrieved record counts by backend layer.
   */
  retrievedLayerCounts?: Record<string, number>
  /**
   * Backend search result counts by layer before final item shaping.
   */
  searchedLayerCounts?: Record<string, number>
}

export interface LoCoMoRetrieverAdapter {
  id: string
  retrieveContext: (input: {
    question: string
    sampleId: string
    topK: number
  }) => Promise<{
    contextIds?: string[]
    contextText: string
    /**
     * Optional backend retrieval diagnostics for report analysis.
     */
    diagnostics?: LoCoMoRetrievalDiagnostics
  }>
}

export interface LoCoMoScorerAdapter {
  id: string
  scoreAnswer: (input: {
    category: LoCoMoCategory
    contextIds?: string[]
    contextText?: string
    goldAnswer: string
    prediction: string
    question: string
    sampleId: string
  }) => Promise<LoCoMoScorerResult>
}

export interface LoCoMoScorerResult {
  reasoning?: string
  score: number
}

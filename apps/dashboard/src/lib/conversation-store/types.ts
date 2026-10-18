/**
 * Conversation storage types for persistent conversation management.
 *
 * Schema design principles:
 *   1. Fixed columns = things you GROUP BY, WHERE, ORDER BY, SUM (dashboards)
 *   2. metadata JSON = extensible drill-down data (no ALTER TABLE ever needed)
 *   3. Works on both D1 (SQLite TEXT) and PostgreSQL (JSONB)
 */

import type { UIMessage } from 'ai'

export interface ConversationMetadata {
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
  noCacheInputTokens?: number
  textOutputTokens?: number

  inputCostUsd?: number
  outputCostUsd?: number
  cacheReadCostUsd?: number
  cacheWriteCostUsd?: number
  cacheDiscount?: number

  streaming?: boolean
  firstTokenMs?: number
  tokensPerSecond?: number
  chunkCount?: number
  streamInterrupted?: boolean
  tokensAtInterruption?: number

  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  /** SHA-256 hash of system prompt (track prompt changes without storing full prompt) */
  systemPromptHash?: string

  currentStage?: string
  stepCount?: number
  stageTransitions?: Array<{
    name: string
    startMs: number
    endMs?: number
    status: 'completed' | 'failed' | 'skipped'
  }>

  toolCallCount?: number
  toolNames?: string[]
  toolDurations?: Record<string, number>
  toolErrors?: Record<string, string>

  summary?: string
  suggestions?: string[]
  tags?: string[]

  retryCount?: number
  regenerationCount?: number
  correctionText?: string

  openrouter?: {
    generationId?: string
    upstreamId?: string
    /** Actual model used after routing (may differ from requested) */
    actualModel?: string
    providerName?: string
    totalCost?: number
    upstreamCost?: number
    upstreamPromptCost?: number
    upstreamCompletionCost?: number
    cacheDiscount?: number
    nativeTokens?: {
      prompt?: number
      completion?: number
      reasoning?: number
      cached?: number
    }
    latencyMs?: number
    generationTimeMs?: number
    moderationLatencyMs?: number
    router?: string
    isByok?: boolean
    nativeFinishReason?: string
    webSearchRequests?: number
  }

  rawUsage?: Record<string, unknown>

  [key: string]: unknown
}

export interface ConversationMeta {
  id: string
  userId: string
  title: string

  messageCount: number

  model?: string
  provider?: string
  hostId?: number

  totalInputTokens?: number
  totalOutputTokens?: number
  totalReasoningTokens?: number
  totalCachedTokens?: number

  totalDurationMs?: number
  totalCostUsd?: number

  finishReason?: string
  userRating?: number
  errorCount?: number

  metadata?: ConversationMetadata

  createdAt: number
  updatedAt: number
}

export interface StoredConversation extends ConversationMeta {
  messages: UIMessage[]
}

/**
 * Conversation storage adapter interface.
 * All backends (D1, PostgreSQL, memory, browser) implement this.
 */
export interface ConversationStore {
  /**
   * List conversations for a user.
   *
   * @param userId - User ID to scope queries
   * @param limit - Maximum number of conversations to return
   * @param sinceMs - Optional Unix-ms lower bound on updated_at (retention cutoff).
   *   When provided, only conversations updated at or after this timestamp are returned.
   *   Undefined = no cutoff (returns all).
   */
  list(
    userId: string,
    limit?: number,
    sinceMs?: number
  ): Promise<ConversationMeta[]>
  get(
    userId: string,
    conversationId: string
  ): Promise<StoredConversation | null>
  upsert(conversation: StoredConversation): Promise<{ written: boolean }>
  delete(userId: string, conversationId: string): Promise<void>
  deleteAll(userId: string): Promise<void>
}

export class ConversationStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'UNAUTHORIZED'
      | 'STORAGE_ERROR'
      | 'VALIDATION_ERROR',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ConversationStoreError'
  }
}

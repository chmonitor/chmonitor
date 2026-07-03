/**
 * Conversation storage types for persistent conversation management.
 *
 * Schema design principles:
 *   1. Fixed columns = things you GROUP BY, WHERE, ORDER BY, SUM (dashboards)
 *   2. metadata JSON = extensible drill-down data (no ALTER TABLE ever needed)
 *   3. Works on both D1 (SQLite TEXT) and PostgreSQL (JSONB)
 */

import type { UIMessage } from 'ai'

// ============================================================================
// Dynamic Metadata (stored as JSON, never needs schema migration)
// ============================================================================

/**
 * Extensible metadata stored in the `metadata` JSON column.
 * All fields optional — only populated when data is available.
 * Add new fields here freely without any database migration.
 */
export interface ConversationMetadata {
  // --- Token granularity (beyond fixed columns) ---
  /** Tokens read from prompt cache (reduced cost, e.g. Anthropic 0.1x) */
  cacheReadInputTokens?: number
  /** Tokens written to prompt cache (surcharge, e.g. Anthropic 1.25x) */
  cacheWriteInputTokens?: number
  /** Non-cached input tokens */
  noCacheInputTokens?: number
  /** Text output tokens (excludes reasoning) */
  textOutputTokens?: number

  // --- Cost breakdown ---
  /** Input token cost (USD) */
  inputCostUsd?: number
  /** Output token cost (USD) */
  outputCostUsd?: number
  /** Cache read cost (reduced rate) */
  cacheReadCostUsd?: number
  /** Cache write cost (surcharge) */
  cacheWriteCostUsd?: number
  /** Cache discount applied by provider */
  cacheDiscount?: number

  // --- Streaming & Performance ---
  /** Whether streaming (SSE) was used */
  streaming?: boolean
  /** Time to first token in ms (streaming only — #1 UX metric) */
  firstTokenMs?: number
  /** Output tokens per second (decode throughput) */
  tokensPerSecond?: number
  /** Number of SSE chunks received */
  chunkCount?: number
  /** Whether user cancelled mid-stream */
  streamInterrupted?: boolean
  /** Tokens generated before cancellation */
  tokensAtInterruption?: number

  // --- LLM Configuration ---
  /** Temperature setting */
  temperature?: number
  /** Max tokens setting */
  maxTokens?: number
  /** Top-p (nucleus sampling) */
  topP?: number
  /** Frequency penalty */
  frequencyPenalty?: number
  /** Presence penalty */
  presencePenalty?: number
  /** SHA-256 hash of system prompt (track prompt changes without storing full prompt) */
  systemPromptHash?: string

  // --- Agent Stages (LangGraph) ---
  /** Current/final stage name */
  currentStage?: string
  /** Total step count across all stages */
  stepCount?: number
  /** Ordered stage transitions */
  stageTransitions?: Array<{
    name: string
    startMs: number
    endMs?: number
    status: 'completed' | 'failed' | 'skipped'
  }>

  // --- Tool Usage ---
  /** Total tool invocations */
  toolCallCount?: number
  /** Unique tool names used */
  toolNames?: string[]
  /** Per-tool durations in ms */
  toolDurations?: Record<string, number>
  /** Per-tool error messages */
  toolErrors?: Record<string, string>

  // --- Conversation Context ---
  /** Auto-generated summary of conversation */
  summary?: string
  /** Suggested next questions/actions */
  suggestions?: string[]
  /** User-defined labels */
  tags?: string[]

  // --- Quality & Feedback ---
  /** Number of retried LLM requests */
  retryCount?: number
  /** Number of regenerated responses */
  regenerationCount?: number
  /** User correction text (if they edited the response) */
  correctionText?: string

  // --- OpenRouter-specific (from /generation stats API) ---
  openrouter?: {
    /** OpenRouter generation ID (use to query /api/v1/generation?id=...) */
    generationId?: string
    /** Upstream provider's generation ID */
    upstreamId?: string
    /** Actual model used after routing (may differ from requested) */
    actualModel?: string
    /** Upstream provider name (e.g. "anthropic", "openai") */
    providerName?: string
    /** Total cost in OpenRouter credits */
    totalCost?: number
    /** Upstream inference cost breakdown */
    upstreamCost?: number
    /** Upstream prompt cost */
    upstreamPromptCost?: number
    /** Upstream completion cost */
    upstreamCompletionCost?: number
    /** Cache discount applied */
    cacheDiscount?: number
    /** Native token counts from underlying provider */
    nativeTokens?: {
      prompt?: number
      completion?: number
      reasoning?: number
      cached?: number
    }
    /** Latency breakdown */
    latencyMs?: number
    generationTimeMs?: number
    moderationLatencyMs?: number
    /** Routing strategy used */
    router?: string
    /** Whether user's own API key was used */
    isByok?: boolean
    /** Finish reason from native provider */
    nativeFinishReason?: string
    /** Web search requests made */
    webSearchRequests?: number
  }

  // --- AI SDK raw response (escape hatch) ---
  /** Raw usage object from AI SDK (provider-specific, for debugging) */
  rawUsage?: Record<string, unknown>

  // --- Escape hatch for future fields ---
  [key: string]: unknown
}

// ============================================================================
// Core Types
// ============================================================================

/**
 * Conversation metadata (without full message payload).
 * Used for listing conversations efficiently.
 * Fixed columns map directly to database columns for indexing/filtering.
 */
export interface ConversationMeta {
  // --- Identity ---
  id: string
  userId: string
  title: string

  // --- Content summary ---
  messageCount: number

  // --- LLM configuration (filterable in dashboards) ---
  model?: string
  provider?: string
  hostId?: number

  // --- Token usage (aggregatable for usage dashboards) ---
  totalInputTokens?: number
  totalOutputTokens?: number
  totalReasoningTokens?: number
  totalCachedTokens?: number

  // --- Performance (aggregatable) ---
  totalDurationMs?: number
  totalCostUsd?: number

  // --- Quality signals (filterable) ---
  finishReason?: string
  userRating?: number
  errorCount?: number

  // --- Extensible metadata (JSON, never needs migration) ---
  metadata?: ConversationMetadata

  // --- Timestamps (Unix ms) ---
  createdAt: number
  updatedAt: number
}

/**
 * Full stored conversation with all messages.
 */
export interface StoredConversation extends ConversationMeta {
  messages: UIMessage[]
}

// ============================================================================
// Storage Interface
// ============================================================================

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

// ============================================================================
// Errors
// ============================================================================

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

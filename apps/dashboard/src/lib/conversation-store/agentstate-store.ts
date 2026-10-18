/**
 * AgentState-backed conversation storage.
 *
 * This module provides a ConversationStore implementation backed by the
 * AgentState conversation-history service (https://agentstate.app). Each
 * dashboard conversation is mapped to an AgentState conversation keyed by a
 * deterministic `external_id` of the form `${userId}:${conversationId}`, which
 * gives strong per-user isolation and lets us look conversations up without
 * tracking AgentState's internal ids.
 *
 * Lossless round-tripping: the full assistant-ui `UIMessage` is stored inside
 * each AgentState message's `metadata.ui` field so that reads reconstruct the
 * exact same UIMessage (including non-text parts). The flattened text content
 * is also written to AgentState's `content` column so the service can run
 * title / follow-up generation against readable text.
 *
 * Append-only writes: AgentState messages are immutable, so `upsert` diffs the
 * incoming messages against what is already stored (by UIMessage id) and only
 * appends the new ones, then updates the conversation title/metadata.
 */

import type {
  Conversation,
  ConversationWithMessages,
  Message,
} from '@agentstate/sdk'
import type { UIMessage } from 'ai'
import type {
  ConversationMeta,
  ConversationMetadata,
  ConversationStore,
  StoredConversation,
} from './types'

import { ConversationStoreError } from './types'
import { AgentState, AgentStateError } from '@agentstate/sdk'
import { debug, error as logError } from '@chm/logger'

const DEFAULT_BASE_URL = 'https://agentstate.app/api'

const APP_ID = 'clickhouse-monitoring'

const GENERIC_TITLES = new Set([
  'New Conversation',
  'New Chat',
  'Untitled Conversation',
  'Untitled',
  '',
])

const LIST_PAGE_SIZE = 100

/**
 * Maximum number of conversations to scan across pages when filtering by user.
 *
 * AgentState's list endpoint has no server-side user filter, so {@link
 * AgentStateStore.list} pages newest-first through the shared project and keeps
 * client-side only the requesting user's conversations.
 *
 * Scanning by conversation count (not page count) and raising the budget keeps
 * the common case cheap — for an active user, their `limit` conversations are
 * collected from the first page or two and the loop exits early — while still
 * covering realistically large shared projects. The cap remains a deliberate,
 * bounded trade-off: a user whose oldest conversations sit beneath more than
 * {@link MAX_LIST_SCAN} newer global conversations can still miss the tail. The
 * proper long-term fix is a server-side per-user filter (absent from the SDK)
 * or a per-user conversation index.
 */
const MAX_LIST_SCAN = 5000

export interface AgentStateStoreOptions {
  apiKey: string
  baseUrl?: string
  aiEnrich?: boolean
}

interface StoredConversationMetadata {
  userId: string
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
  app: string
  tags?: string[]
  meta?: ConversationMetadata
}

export class AgentStateStore implements ConversationStore {
  private readonly client: AgentState
  private readonly aiEnrich: boolean

  constructor(options: AgentStateStoreOptions) {
    const { apiKey, baseUrl = DEFAULT_BASE_URL, aiEnrich = false } = options

    if (!apiKey) {
      throw new ConversationStoreError(
        'AGENTSTATE_API_KEY is required to construct AgentStateStore',
        'VALIDATION_ERROR'
      )
    }

    this.client = new AgentState({ apiKey, baseUrl })
    this.aiEnrich = aiEnrich
  }

  private externalId(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`
  }

  private conversationIdFromExternal(
    externalId: string | null,
    userId: string
  ): string | null {
    if (!externalId) {
      return null
    }
    const prefix = `${userId}:`
    if (externalId.startsWith(prefix)) {
      return externalId.slice(prefix.length)
    }
    return null
  }

  /**
   * Convert a UIMessage into the AgentState message shape. The full UIMessage
   * is preserved under `metadata.ui` for lossless reads; `content` is the
   * concatenated text of all text parts (never empty — AgentState requires at
   * least one character).
   */
  private toAgentMessage(
    uiMessage: UIMessage
  ): Omit<Message, 'id' | 'created_at'> {
    const text = (uiMessage.parts ?? [])
      .filter(
        (part): part is { type: 'text'; text: string } =>
          part.type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
      )
      .map((part) => part.text)
      .join('')

    const role: Message['role'] =
      uiMessage.role === 'user' ||
      uiMessage.role === 'assistant' ||
      uiMessage.role === 'system'
        ? uiMessage.role
        : 'assistant'

    return {
      role,
      content: text || ' ',
      metadata: {
        ui: uiMessage as unknown,
        uiId: uiMessage.id,
      },
    }
  }

  /**
   * Reconstruct a UIMessage from an AgentState message. Uses the lossless
   * `metadata.ui` copy when present, otherwise builds a minimal text message.
   */
  private fromAgentMessage(agentMessage: Message): UIMessage {
    const metadata = (agentMessage.metadata ?? {}) as Record<string, unknown>
    const ui = metadata.ui

    if (ui && typeof ui === 'object') {
      return ui as UIMessage
    }

    const role: UIMessage['role'] =
      agentMessage.role === 'user' ||
      agentMessage.role === 'assistant' ||
      agentMessage.role === 'system'
        ? agentMessage.role
        : 'assistant'

    return {
      id: agentMessage.id ?? crypto.randomUUID(),
      role,
      parts: [{ type: 'text', text: agentMessage.content }],
    }
  }

  private uiIdOf(agentMessage: Message): string | undefined {
    const metadata = (agentMessage.metadata ?? {}) as Record<string, unknown>
    const uiId = metadata.uiId
    return typeof uiId === 'string' ? uiId : undefined
  }

  private buildMetadata(
    conversation: StoredConversation
  ): Record<string, unknown> {
    const metadata: StoredConversationMetadata = {
      userId: conversation.userId,
      app: APP_ID,
      tags: [`user:${conversation.userId}`],
    }

    if (conversation.model !== undefined) metadata.model = conversation.model
    if (conversation.provider !== undefined)
      metadata.provider = conversation.provider
    if (conversation.hostId !== undefined) metadata.hostId = conversation.hostId
    if (conversation.totalInputTokens !== undefined)
      metadata.totalInputTokens = conversation.totalInputTokens
    if (conversation.totalOutputTokens !== undefined)
      metadata.totalOutputTokens = conversation.totalOutputTokens
    if (conversation.totalReasoningTokens !== undefined)
      metadata.totalReasoningTokens = conversation.totalReasoningTokens
    if (conversation.totalCachedTokens !== undefined)
      metadata.totalCachedTokens = conversation.totalCachedTokens
    if (conversation.totalDurationMs !== undefined)
      metadata.totalDurationMs = conversation.totalDurationMs
    if (conversation.totalCostUsd !== undefined)
      metadata.totalCostUsd = conversation.totalCostUsd
    if (conversation.finishReason !== undefined)
      metadata.finishReason = conversation.finishReason
    if (conversation.userRating !== undefined)
      metadata.userRating = conversation.userRating
    if (conversation.errorCount !== undefined)
      metadata.errorCount = conversation.errorCount
    if (conversation.metadata !== undefined)
      metadata.meta = conversation.metadata

    return metadata as unknown as Record<string, unknown>
  }

  private toConversationMeta(
    conv: Conversation,
    userId: string
  ): ConversationMeta {
    const metadata = (conv.metadata ??
      {}) as Partial<StoredConversationMetadata>
    const conversationId =
      this.conversationIdFromExternal(conv.external_id, userId) ?? conv.id

    return {
      id: conversationId,
      userId,
      title: conv.title ?? 'Untitled Conversation',
      messageCount: conv.message_count,
      model: metadata.model,
      provider: metadata.provider,
      hostId: metadata.hostId,
      totalInputTokens: metadata.totalInputTokens,
      totalOutputTokens: metadata.totalOutputTokens,
      totalReasoningTokens: metadata.totalReasoningTokens,
      totalCachedTokens: metadata.totalCachedTokens,
      totalDurationMs: metadata.totalDurationMs,
      totalCostUsd: metadata.totalCostUsd,
      finishReason: metadata.finishReason,
      userRating: metadata.userRating,
      errorCount: metadata.errorCount,
      metadata: metadata.meta,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
    }
  }

  private async findByExternalId(
    userId: string,
    conversationId: string
  ): Promise<ConversationWithMessages | null> {
    try {
      return await this.client.getConversationByExternalId(
        this.externalId(userId, conversationId)
      )
    } catch (err) {
      if (this.isNotFound(err)) {
        return null
      }
      throw err
    }
  }

  private isNotFound(err: unknown): boolean {
    return (
      err instanceof AgentStateError &&
      (err.code === 'NOT_FOUND' || err.status === 404)
    )
  }

  private wrap(message: string, err: unknown): ConversationStoreError {
    if (err instanceof ConversationStoreError) {
      return err
    }

    let code: ConversationStoreError['code'] = 'STORAGE_ERROR'
    if (err instanceof AgentStateError) {
      if (err.status === 404 || err.code === 'NOT_FOUND') {
        code = 'NOT_FOUND'
      } else if (err.status === 401 || err.status === 403) {
        code = 'UNAUTHORIZED'
      } else if (err.status === 400) {
        code = 'VALIDATION_ERROR'
      }
    }

    const detail = err instanceof Error ? err.message : 'Unknown error'
    return new ConversationStoreError(`${message}: ${detail}`, code, err)
  }

  /**
   * List conversations for a user.
   *
   * AgentState's list endpoint has no server-side tag/user filter, so this
   * pages through results (newest first) and keeps only conversations whose
   * stored `metadata.userId` matches, for defensive isolation. Scanning stops
   * early once `limit` of the user's conversations are collected or pagination
   * is exhausted, and is bounded overall by {@link MAX_LIST_SCAN} conversations
   * scanned (not pages) so an inactive user's older conversations are not
   * dropped just because newer conversations from other users precede them.
   *
   * @param userId - User ID to scope queries
   * @param limit - Maximum number of conversations to return (default: 50)
   * @returns Array of conversation metadata (no messages)
   */
  async list(
    userId: string,
    limit: number = 50,
    sinceMs?: number
  ): Promise<ConversationMeta[]> {
    try {
      const matches: ConversationMeta[] = []
      let cursor: string | undefined
      let scanned = 0

      while (matches.length < limit && scanned < MAX_LIST_SCAN) {
        const response = await this.client.listConversations({
          order: 'desc',
          limit: LIST_PAGE_SIZE,
          cursor,
        })

        for (const conv of response.data) {
          scanned += 1
          const metadata = (conv.metadata ??
            {}) as Partial<StoredConversationMetadata>
          if (metadata.userId !== userId) {
            continue
          }
          if (sinceMs != null && conv.updated_at < sinceMs) {
            continue
          }
          matches.push(this.toConversationMeta(conv, userId))
          if (matches.length >= limit) {
            break
          }
        }

        cursor = response.pagination.next_cursor ?? undefined
        if (!cursor) {
          break
        }
      }

      return matches.slice(0, limit)
    } catch (err) {
      logError('[AgentStateStore.list] Failed to list conversations', err)
      throw this.wrap('Failed to list conversations', err)
    }
  }

  async get(
    userId: string,
    conversationId: string
  ): Promise<StoredConversation | null> {
    try {
      const conv = await this.findByExternalId(userId, conversationId)
      if (!conv) {
        return null
      }

      const metadata = (conv.metadata ??
        {}) as Partial<StoredConversationMetadata>
      // Defensive isolation: never return another user's conversation.
      if (metadata.userId !== userId) {
        return null
      }

      const meta = this.toConversationMeta(conv, userId)
      const messages = (conv.messages ?? []).map((message) =>
        this.fromAgentMessage(message)
      )

      return {
        ...meta,
        messages,
      }
    } catch (err) {
      if (this.isNotFound(err)) {
        return null
      }
      logError('[AgentStateStore.get] Failed to get conversation', err)
      throw this.wrap('Failed to get conversation', err)
    }
  }

  /**
   * Create or update a conversation (append-only diff).
   *
   * - If the conversation does not exist, it is created with all messages.
   * - If it exists, only UIMessages whose id is not already stored are
   *   appended, then the title and metadata are updated.
   *
   * When AI enrichment is enabled and the resulting title is empty or generic,
   * a best-effort `generateTitle` call is made (failures are swallowed).
   *
   * @param conversation - Full conversation to upsert
   * @returns `written: true` — this backend is namespaced per user via the
   *   deterministic `${userId}:${conversationId}` external id, so a write
   *   always either creates or updates the caller's own conversation
   */
  async upsert(
    conversation: StoredConversation
  ): Promise<{ written: boolean }> {
    try {
      const externalId = this.externalId(conversation.userId, conversation.id)
      const metadata = this.buildMetadata(conversation)
      const existing = await this.findByExternalId(
        conversation.userId,
        conversation.id
      )

      let internalId: string

      if (!existing) {
        const created = await this.client.createConversation({
          external_id: externalId,
          title: conversation.title,
          metadata,
          messages: conversation.messages.map((message) =>
            this.toAgentMessage(message)
          ),
        })
        internalId = created.id
      } else {
        internalId = existing.id

        const storedUiIds = new Set(
          (existing.messages ?? [])
            .map((message) => this.uiIdOf(message))
            .filter((id): id is string => id !== undefined)
        )
        const toAppend = conversation.messages.filter(
          (message) => !storedUiIds.has(message.id)
        )
        if (toAppend.length > 0) {
          await this.client.appendMessages(
            internalId,
            toAppend.map((message) => this.toAgentMessage(message))
          )
        }

        await this.client.updateConversation(internalId, {
          title: conversation.title,
          metadata,
        })
      }

      await this.maybeEnrichTitle(internalId, conversation)
      return { written: true }
    } catch (err) {
      logError('[AgentStateStore.upsert] Failed to upsert conversation', err)
      throw this.wrap('Failed to upsert conversation', err)
    }
  }

  /**
   * Best-effort AI title generation. Only runs when AI enrichment is enabled,
   * the current title is empty or generic, and the conversation has at least
   * one user message and one assistant message. Never throws — enrichment
   * failures must not fail the upsert.
   */
  private async maybeEnrichTitle(
    internalId: string,
    conversation: StoredConversation
  ): Promise<void> {
    if (!this.aiEnrich) {
      return
    }
    if (!GENERIC_TITLES.has(conversation.title)) {
      return
    }

    const hasUser = conversation.messages.some((m) => m.role === 'user')
    const hasAssistant = conversation.messages.some(
      (m) => m.role === 'assistant'
    )
    if (!hasUser || !hasAssistant) {
      return
    }

    try {
      const { title } = await this.client.generateTitle(internalId)
      debug('[AgentStateStore.maybeEnrichTitle] Generated title', {
        internalId,
        title,
      })
      const nextTitle = typeof title === 'string' ? title.trim() : ''
      if (nextTitle && !GENERIC_TITLES.has(nextTitle)) {
        await this.client.updateConversation(internalId, { title: nextTitle })
      }
    } catch (err) {
      // Swallow — enrichment is best-effort and must never fail the upsert.
      logError(
        '[AgentStateStore.maybeEnrichTitle] Title generation failed',
        err
      )
    }
  }

  /**
   * Delete a single conversation (no-op if missing or not owned).
   *
   * @param userId - User ID to scope queries (security check)
   * @param conversationId - Conversation ID to delete
   */
  async delete(userId: string, conversationId: string): Promise<void> {
    try {
      const existing = await this.findByExternalId(userId, conversationId)
      if (!existing) {
        return
      }

      const metadata = (existing.metadata ??
        {}) as Partial<StoredConversationMetadata>
      if (metadata.userId !== userId) {
        return
      }

      await this.client.deleteConversation(existing.id)
    } catch (err) {
      if (this.isNotFound(err)) {
        return
      }
      logError('[AgentStateStore.delete] Failed to delete conversation', err)
      throw this.wrap('Failed to delete conversation', err)
    }
  }

  async deleteAll(userId: string): Promise<void> {
    try {
      let cursor: string | undefined

      do {
        const response = await this.client.listConversations({
          order: 'desc',
          limit: LIST_PAGE_SIZE,
          cursor,
        })

        for (const conv of response.data) {
          const metadata = (conv.metadata ??
            {}) as Partial<StoredConversationMetadata>
          if (metadata.userId !== userId) {
            continue
          }
          await this.client.deleteConversation(conv.id)
        }

        cursor = response.pagination.next_cursor ?? undefined
      } while (cursor)
    } catch (err) {
      logError(
        '[AgentStateStore.deleteAll] Failed to delete all conversations',
        err
      )
      throw this.wrap('Failed to delete all conversations', err)
    }
  }

  /**
   * Generate AI follow-up question suggestions for a conversation.
   *
   * Resolves the AgentState internal id via the external id, then calls
   * AgentState's follow-up generation.
   *
   * @param userId - User ID to scope queries (security check)
   * @param conversationId - Conversation ID to suggest follow-ups for
   * @returns Array of suggested follow-up questions
   * @throws ConversationStoreError NOT_FOUND when the conversation is missing
   */
  async followUps(userId: string, conversationId: string): Promise<string[]> {
    try {
      const existing = await this.findByExternalId(userId, conversationId)
      if (!existing) {
        throw new ConversationStoreError(
          `Conversation ${conversationId} not found`,
          'NOT_FOUND'
        )
      }

      const metadata = (existing.metadata ??
        {}) as Partial<StoredConversationMetadata>
      if (metadata.userId !== userId) {
        throw new ConversationStoreError(
          `Conversation ${conversationId} not found`,
          'NOT_FOUND'
        )
      }

      const { questions } = await this.client.generateFollowUps(existing.id)
      return questions
    } catch (err) {
      logError('[AgentStateStore.followUps] Failed to generate follow-ups', err)
      throw this.wrap('Failed to generate follow-ups', err)
    }
  }
}

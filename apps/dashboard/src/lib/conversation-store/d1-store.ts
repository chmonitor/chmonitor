/**
 * D1-based conversation storage for Cloudflare Workers.
 *
 * This module provides a ConversationStore implementation backed by Cloudflare D1
 * (SQLite-based database). It stores conversations with full message history
 * and provides efficient querying for conversation lists.
 */

import type { UIMessage } from 'ai'
import type {
  ConversationMeta,
  ConversationStore,
  StoredConversation,
} from './types'

import { ConversationStoreError } from './types'
import { getPlatformBindings } from '@chm/platform'

/**
 * D1 database schema row shape.
 */
interface D1ConversationRow {
  id: string
  user_id: string
  title: string
  messages: string // JSON string
  message_count: number
  created_at: number
  updated_at: number
}

/**
 * Upsert SQL for the `conversations` table.
 *
 * The `ON CONFLICT` update deliberately excludes `user_id` from the `SET`
 * list and guards the update with a `WHERE` clause so a conflicting row
 * owned by a different user is never touched: SQLite's `DO UPDATE ... WHERE`
 * evaluates the guard per matched row and leaves it unchanged (0 `changes`)
 * when the guard is false, instead of reassigning ownership to the caller.
 *
 * Exported so `d1-store.sql.test.ts` can run this exact string against
 * `bun:sqlite` (SQLite is D1's engine) and prove the guard behaves as
 * expected, rather than re-deriving it in the test.
 */
export const D1_UPSERT_CONVERSATION_SQL = `INSERT INTO conversations (id, user_id, title, messages, message_count, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
   ON CONFLICT (id) DO UPDATE SET
     title = excluded.title,
     messages = excluded.messages,
     message_count = excluded.message_count,
     updated_at = excluded.updated_at
   WHERE conversations.user_id = excluded.user_id`

/**
 * D1-based conversation storage implementation.
 *
 * Uses Cloudflare D1 (SQLite) for persistent storage of AI agent conversations.
 * Messages are stored as JSON strings since D1 doesn't support JSONB.
 *
 * @example
 * ```ts
 * const store = new D1Store()
 * await store.upsert({
 *   id: 'conv-123',
 *   userId: 'user-abc',
 *   title: 'My Conversation',
 *   messages: [...],
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   messageCount: 5
 * })
 * ```
 */
export class D1Store implements ConversationStore {
  private getDb(): D1Database {
    const db = getPlatformBindings().getD1Database('CHM_CLOUD_D1')

    if (!db) {
      throw new ConversationStoreError(
        'CHM_CLOUD_D1 binding not found. Ensure D1 database is configured in wrangler.toml',
        'STORAGE_ERROR'
      )
    }

    return db
  }

  /**
   * List conversations for a user.
   *
   * Returns metadata only (no messages) for efficiency. Results are sorted
   * by updated_at DESC to show most recently active conversations first.
   *
   * @param userId - User ID to scope queries
   * @param limit - Maximum number of conversations to return (default: 50)
   * @returns Array of conversation metadata
   */
  async list(
    userId: string,
    limit: number = 50,
    sinceMs?: number
  ): Promise<ConversationMeta[]> {
    try {
      const db = this.getDb()

      const stmt =
        sinceMs != null
          ? db
              .prepare(
                `SELECT id, user_id, title, message_count, created_at, updated_at
           FROM conversations
           WHERE user_id = ?1 AND updated_at >= ?2
           ORDER BY updated_at DESC
           LIMIT ?3`
              )
              .bind(userId, sinceMs, limit)
          : db
              .prepare(
                `SELECT id, user_id, title, message_count, created_at, updated_at
           FROM conversations
           WHERE user_id = ?1
           ORDER BY updated_at DESC
           LIMIT ?2`
              )
              .bind(userId, limit)

      const result = await stmt.all<D1ConversationRow>()

      return (result.results || []).map(
        (row): ConversationMeta => ({
          id: row.id,
          userId: row.user_id,
          title: row.title,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          messageCount: row.message_count,
        })
      )
    } catch (error) {
      throw new ConversationStoreError(
        `Failed to list conversations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * Get a single conversation with full messages.
   *
   * @param userId - User ID to scope queries (security check)
   * @param conversationId - Conversation ID to retrieve
   * @returns Conversation with messages, or null if not found
   */
  async get(
    userId: string,
    conversationId: string
  ): Promise<StoredConversation | null> {
    try {
      const db = this.getDb()

      const stmt = db
        .prepare(
          `SELECT id, user_id, title, messages, message_count, created_at, updated_at
           FROM conversations
           WHERE id = ?1 AND user_id = ?2`
        )
        .bind(conversationId, userId)

      const result = await stmt.first<D1ConversationRow>()

      if (!result) {
        return null
      }

      // Parse messages JSON string
      let messages: UIMessage[]
      try {
        messages = JSON.parse(result.messages) as UIMessage[]
      } catch (error) {
        throw new ConversationStoreError(
          `Failed to parse messages JSON for conversation ${conversationId}`,
          'STORAGE_ERROR',
          error
        )
      }

      return {
        id: result.id,
        userId: result.user_id,
        title: result.title,
        messages,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
        messageCount: result.message_count,
      }
    } catch (error) {
      if (error instanceof ConversationStoreError) {
        throw error
      }
      throw new ConversationStoreError(
        `Failed to get conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * Create or update a conversation.
   *
   * Uses UPSERT (INSERT OR REPLACE) semantics:
   * - If conversation exists and is owned by the caller: replaces all fields
   *   including messages
   * - If conversation doesn't exist: creates new conversation
   * - If conversation exists but is owned by a different user: the `WHERE`
   *   guard in {@link D1_UPSERT_CONVERSATION_SQL} blocks the update (0 rows
   *   changed) rather than reassigning ownership to the caller
   *
   * @param conversation - Full conversation to upsert
   * @returns `written: true` if a row was inserted or updated; `written:
   *   false` when the id belongs to another user and the write was blocked
   */
  async upsert(
    conversation: StoredConversation
  ): Promise<{ written: boolean }> {
    try {
      const db = this.getDb()

      // Serialize messages to JSON string
      const messagesJson = JSON.stringify(conversation.messages)

      const stmt = db
        .prepare(D1_UPSERT_CONVERSATION_SQL)
        .bind(
          conversation.id,
          conversation.userId,
          conversation.title,
          messagesJson,
          conversation.messageCount,
          conversation.createdAt,
          conversation.updatedAt
        )

      const res = await stmt.run()
      return { written: (res.meta?.changes ?? 0) > 0 }
    } catch (error) {
      throw new ConversationStoreError(
        `Failed to upsert conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * Delete a single conversation.
   *
   * @param userId - User ID to scope queries (security check)
   * @param conversationId - Conversation ID to delete
   */
  async delete(userId: string, conversationId: string): Promise<void> {
    try {
      const db = this.getDb()

      const stmt = db
        .prepare(`DELETE FROM conversations WHERE id = ?1 AND user_id = ?2`)
        .bind(conversationId, userId)

      await stmt.run()
    } catch (error) {
      throw new ConversationStoreError(
        `Failed to delete conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * Delete all conversations for a user.
   *
   * @param userId - User ID to scope queries
   */
  async deleteAll(userId: string): Promise<void> {
    try {
      const db = this.getDb()

      const stmt = db
        .prepare(`DELETE FROM conversations WHERE user_id = ?1`)
        .bind(userId)

      await stmt.run()
    } catch (error) {
      throw new ConversationStoreError(
        `Failed to delete all conversations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }
}

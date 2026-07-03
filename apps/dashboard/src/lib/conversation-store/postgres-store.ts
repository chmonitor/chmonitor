/**
 * PostgreSQL-based conversation storage for production deployments.
 *
 * This module provides a ConversationStore implementation backed by PostgreSQL.
 * It stores conversations with full message history and provides efficient
 * querying for conversation lists using JSONB for native JSON support.
 *
 * Features:
 * - Auto-migration on first query (idempotent CREATE TABLE IF NOT EXISTS)
 * - Connection pooling via postgres package (lightweight, Workers-compatible)
 * - JSONB column for efficient JSON storage and querying
 * - Comprehensive error handling with detailed error codes
 */

import type { UIMessage } from 'ai'
import type {
  ConversationMeta,
  ConversationStore,
  StoredConversation,
} from './types'

import { ConversationStoreError } from './types'
import postgres from 'postgres'

/**
 * PostgreSQL database schema row shape.
 */
interface PostgresConversationRow {
  id: string
  user_id: string
  title: string
  messages: unknown // JSONB parsed by postgres package
  message_count: number
  created_at: number
  updated_at: number
}

/**
 * SQL migration script for conversations table.
 *
 * Uses JSONB for messages column (Postgres native JSON type with indexing support).
 * Includes composite index on user_id and updated_at for efficient listing queries.
 */
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  messages JSONB NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
  ON conversations(user_id, updated_at DESC);
`

/**
 * PostgreSQL-based conversation storage implementation.
 *
 * Uses the 'postgres' package (~50KB) which is compatible with:
 * - Node.js server environments
 * - Cloudflare Workers (via @cloudflare/workers-postgres)
 * - Vercel/Netlify serverless functions
 *
 * Auto-migration: Runs CREATE TABLE IF NOT EXISTS on first query.
 *
 * Environment variables:
 * - DATABASE_URL: PostgreSQL connection string (required)
 *
 * @example
 * ```ts
 * const store = new PostgresStore()
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
export class PostgresStore implements ConversationStore {
  private sql: ReturnType<typeof postgres>
  private initialized = false

  constructor(connectionString?: string) {
    const url =
      connectionString ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL

    if (!url) {
      throw new ConversationStoreError(
        'DATABASE_URL environment variable is required for PostgreSQL conversation store',
        'STORAGE_ERROR'
      )
    }

    // Create postgres client with connection pooling
    // Default options optimized for serverless/Workers
    this.sql = postgres(url, {
      max: 1, // Single connection for serverless (connection per invocation)
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // Disable prepared statements for better compatibility
    })
  }

  /**
   * Ensure database schema exists.
   *
   * Runs migration on first query (idempotent).
   * Safe to call multiple times - uses CREATE TABLE IF NOT EXISTS.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      // Run migration (idempotent)
      await this.sql.unsafe(MIGRATION_SQL)
      this.initialized = true
    } catch (error) {
      throw new ConversationStoreError(
        `Failed to initialize database schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * List conversations for a user.
   *
   * Returns metadata only (no messages) for efficiency. Results are sorted
   * by updated_at DESC to show most recently active conversations first.
   *
   * Uses composite index (user_id, updated_at) for optimal query performance.
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
    await this.ensureInitialized()

    try {
      const rows = (
        sinceMs != null
          ? await this.sql`
        SELECT id, user_id, title, message_count, created_at, updated_at
        FROM conversations
        WHERE user_id = ${userId} AND updated_at >= ${sinceMs}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
          : await this.sql`
        SELECT id, user_id, title, message_count, created_at, updated_at
        FROM conversations
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
      ) as PostgresConversationRow[]

      return rows.map(
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
   * Messages are returned as JavaScript objects (postgres package
   * automatically parses JSONB columns).
   *
   * @param userId - User ID to scope queries (security check)
   * @param conversationId - Conversation ID to retrieve
   * @returns Conversation with messages, or null if not found
   */
  async get(
    userId: string,
    conversationId: string
  ): Promise<StoredConversation | null> {
    await this.ensureInitialized()

    try {
      const rows = (await this.sql`
        SELECT id, user_id, title, messages, message_count, created_at, updated_at
        FROM conversations
        WHERE id = ${conversationId} AND user_id = ${userId}
      `) as PostgresConversationRow[]

      if (!rows || rows.length === 0) {
        return null
      }

      const row = rows[0]

      // postgres package automatically parses JSONB to JavaScript objects
      // No need for JSON.parse
      const messages = (row.messages as unknown[]).filter(
        (msg): msg is UIMessage =>
          msg !== null &&
          typeof msg === 'object' &&
          'id' in msg &&
          'role' in msg
      )

      return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        messages,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count,
      }
    } catch (error) {
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
   * Uses PostgreSQL's INSERT ... ON CONFLICT (upsert) semantics:
   * - If conversation exists and is owned by the caller: replaces all fields
   *   including messages
   * - If conversation doesn't exist: creates new conversation
   * - If conversation exists but is owned by a different user: the `WHERE`
   *   guard blocks the update (0 rows affected) rather than reassigning
   *   ownership to the caller
   *
   * Messages are serialized to JSONB (Postgres automatically converts
   * JavaScript objects to JSONB).
   *
   * @param conversation - Full conversation to upsert
   * @returns `written: true` if a row was inserted or updated; `written:
   *   false` when the id belongs to another user and the write was blocked
   */
  async upsert(
    conversation: StoredConversation
  ): Promise<{ written: boolean }> {
    await this.ensureInitialized()

    try {
      // Serialize messages to JSON string for safe parameter passing
      const messagesJson = JSON.stringify(conversation.messages)

      const res = await this.sql`
        INSERT INTO conversations (
          id, user_id, title, messages, message_count, created_at, updated_at
        )
        VALUES (
          ${conversation.id},
          ${conversation.userId},
          ${conversation.title},
          ${messagesJson}::jsonb,      -- Cast string to JSONB
          ${conversation.messageCount},
          ${conversation.createdAt},
          ${conversation.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          messages = EXCLUDED.messages,
          message_count = EXCLUDED.message_count,
          updated_at = EXCLUDED.updated_at
        WHERE conversations.user_id = EXCLUDED.user_id
      `
      return { written: res.count > 0 }
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
   * Includes user_id check for security (prevents cross-user deletion).
   *
   * @param userId - User ID to scope queries (security check)
   * @param conversationId - Conversation ID to delete
   */
  async delete(userId: string, conversationId: string): Promise<void> {
    await this.ensureInitialized()

    try {
      await this.sql`
        DELETE FROM conversations
        WHERE id = ${conversationId} AND user_id = ${userId}
      `
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
   * Useful for user data deletion requests (GDPR, etc).
   *
   * @param userId - User ID to scope queries
   */
  async deleteAll(userId: string): Promise<void> {
    await this.ensureInitialized()

    try {
      await this.sql`
        DELETE FROM conversations
        WHERE user_id = ${userId}
      `
    } catch (error) {
      throw new ConversationStoreError(
        `Failed to delete all conversations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * Close the database connection.
   *
   * Call this when shutting down the application to gracefully
   * close the PostgreSQL connection.
   *
   * @example
   * ```ts
   * const store = new PostgresStore()
   * // ... use store
   * await store.close()
   * ```
   */
  async close(): Promise<void> {
    try {
      await this.sql.end()
    } catch (_error) {
      // Ignore errors during close (connection may already be closed)
    }
  }
}

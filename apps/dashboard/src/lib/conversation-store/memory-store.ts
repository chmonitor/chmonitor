/**
 * In-memory conversation store for development and testing.
 *
 * This is a simple Map-based implementation that stores conversations
 * in memory. Data is lost on process restart.
 *
 * Use this when:
 * - Feature flag is enabled but no database is configured
 * - Running tests or local development
 * - Demonstrating the conversation feature
 *
 * For production, use D1Store or PgStore instead.
 */

import type {
  ConversationMeta,
  ConversationStore,
  StoredConversation,
} from './types'

/**
 * In-memory storage keyed by userId.
 * Each user has an array of conversations.
 */
const storage = new Map<string, StoredConversation[]>()

export class MemoryStore implements ConversationStore {
  async list(
    userId: string,
    limit?: number,
    sinceMs?: number
  ): Promise<ConversationMeta[]> {
    const conversations = storage.get(userId) || []

    let sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

    if (sinceMs != null) {
      sorted = sorted.filter((c) => c.updatedAt >= sinceMs)
    }

    const limited = limit ? sorted.slice(0, limit) : sorted

    return limited.map(({ messages, ...meta }) => meta)
  }

  async get(
    userId: string,
    conversationId: string
  ): Promise<StoredConversation | null> {
    const conversations = storage.get(userId) || []

    const found = conversations.find((c) => c.id === conversationId)

    if (!found) {
      return null
    }

    // Return a copy to prevent external mutations
    return { ...found, messages: [...found.messages] }
  }

  /**
   * Create or update a conversation.
   *
   * Mirrors the D1/Postgres ownership guard: `id` is a global primary key
   * (not scoped per user), so if another user already owns this id, the
   * write is refused rather than reassigning ownership to the caller.
   *
   * @param conversation - Full conversation to upsert
   * @returns `written: true` if the conversation was created or updated;
   *   `written: false` when the id belongs to another user and the write
   *   was blocked
   */
  async upsert(
    conversation: StoredConversation
  ): Promise<{ written: boolean }> {
    const { userId, id } = conversation

    // Global id collision check: refuse the write if a different user
    // already owns a conversation with this id.
    for (const [ownerId, conversations] of storage) {
      if (ownerId !== userId && conversations.some((c) => c.id === id)) {
        return { written: false }
      }
    }

    let conversations = storage.get(userId) || []

    const existingIndex = conversations.findIndex((c) => c.id === id)

    if (existingIndex >= 0) {
      // Update existing conversation
      // Store a copy to prevent external mutations
      conversations[existingIndex] = {
        ...conversation,
        messages: [...conversation.messages],
      }
    } else {
      // Add new conversation
      // Store a copy to prevent external mutations
      conversations.push({
        ...conversation,
        messages: [...conversation.messages],
      })
    }

    conversations = conversations.sort((a, b) => b.updatedAt - a.updatedAt)

    storage.set(userId, conversations)
    return { written: true }
  }

  async delete(userId: string, conversationId: string): Promise<void> {
    const conversations = storage.get(userId) || []

    const filtered = conversations.filter((c) => c.id !== conversationId)

    storage.set(userId, filtered)
  }

  async deleteAll(userId: string): Promise<void> {
    storage.set(userId, [])
  }

  static clearAll(): void {
    storage.clear()
  }

  static getGlobalCount(): number {
    return Array.from(storage.values()).reduce(
      (sum, conversations) => sum + conversations.length,
      0
    )
  }

  static getUserIds(): string[] {
    return Array.from(storage.keys())
  }

  static getAllConversations(): Map<string, StoredConversation[]> {
    return new Map(storage)
  }
}

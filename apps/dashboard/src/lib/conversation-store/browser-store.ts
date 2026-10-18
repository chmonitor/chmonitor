/**
 * Browser localStorage adapter for conversation storage.
 *
 * This adapter wraps the existing conversation-utils.ts functions
 * behind the ConversationStore interface, providing a seamless
 * migration path for localStorage-based conversation storage.
 *
 * Note: The userId parameter is accepted for interface compatibility
 * but is ignored, since localStorage is inherently single-user per browser.
 */

import type {
  ConversationMeta,
  ConversationStore,
  StoredConversation,
} from './types'

import { ConversationStoreError } from './types'
import {
  type Conversation,
  loadConversations,
  saveConversations,
} from '@/lib/ai/agent/conversation-utils'

const DEFAULT_USER_ID = 'local'

export class BrowserStore implements ConversationStore {
  /**
   * List conversations for a user.
   *
   * Note: userId parameter is ignored for localStorage storage,
   * as all conversations are stored in a single localStorage bucket.
   *
   * @param userId - User ID (ignored, accepted for interface compatibility)
   * @param limit - Maximum number of conversations to return
   * @returns Array of conversation metadata, sorted by updatedAt DESC
   */
  async list(
    _userId: string,
    limit?: number,
    sinceMs?: number
  ): Promise<ConversationMeta[]> {
    try {
      const conversations = loadConversations()

      let meta: ConversationMeta[] = conversations.map((conv) => ({
        id: conv.id,
        userId: DEFAULT_USER_ID,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
      }))

      if (sinceMs != null) {
        meta = meta.filter((m) => m.updatedAt >= sinceMs)
      }

      const result = limit ? meta.slice(0, limit) : meta

      return result
    } catch (error) {
      throw new ConversationStoreError(
        'Failed to list conversations from localStorage',
        'STORAGE_ERROR',
        error
      )
    }
  }

  async get(
    _userId: string,
    conversationId: string
  ): Promise<StoredConversation | null> {
    try {
      const conversations = loadConversations()
      const conversation = conversations.find((c) => c.id === conversationId)

      if (!conversation) {
        return null
      }

      return {
        id: conversation.id,
        userId: DEFAULT_USER_ID,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        messages: conversation.messages,
      }
    } catch (error) {
      throw new ConversationStoreError(
        'Failed to get conversation from localStorage',
        'STORAGE_ERROR',
        error
      )
    }
  }

  async upsert(
    conversation: StoredConversation
  ): Promise<{ written: boolean }> {
    try {
      const conversations = loadConversations()

      const conv: Conversation = {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages,
      }

      const index = conversations.findIndex((c) => c.id === conversation.id)

      if (index >= 0) {
        conversations[index] = conv
      } else {
        conversations.push(conv)
      }

      conversations.sort((a, b) => b.updatedAt - a.updatedAt)

      saveConversations(conversations)
      return { written: true }
    } catch (error) {
      throw new ConversationStoreError(
        'Failed to upsert conversation to localStorage',
        'STORAGE_ERROR',
        error
      )
    }
  }

  async delete(_userId: string, conversationId: string): Promise<void> {
    try {
      const conversations = loadConversations()
      const filtered = conversations.filter((c) => c.id !== conversationId)

      if (filtered.length === conversations.length) {
        throw new ConversationStoreError(
          `Conversation ${conversationId} not found`,
          'NOT_FOUND'
        )
      }

      saveConversations(filtered)
    } catch (error) {
      if (error instanceof ConversationStoreError) {
        throw error
      }
      throw new ConversationStoreError(
        'Failed to delete conversation from localStorage',
        'STORAGE_ERROR',
        error
      )
    }
  }

  /**
   * Delete all conversations for a user.
   *
   * Note: This will delete ALL conversations since localStorage
   * is single-user per browser. The userId parameter is ignored.
   *
   * @param userId - User ID (ignored, accepted for interface compatibility)
   */
  async deleteAll(_userId: string): Promise<void> {
    try {
      saveConversations([])
    } catch (error) {
      throw new ConversationStoreError(
        'Failed to delete all conversations from localStorage',
        'STORAGE_ERROR',
        error
      )
    }
  }
}

export const browserStore = new BrowserStore()

/**
 * Conversation utility functions for the AI chat agent.
 *
 * Provides utilities for:
 * - Generating unique conversation IDs
 * - Creating conversation titles from user messages
 * - Formatting timestamps as relative time
 * - Persisting conversations to localStorage
 */

import type { UIMessage } from 'ai'

const CONVERSATIONS_STORAGE_KEY = 'clickhouse-agent-conversations'

const MAX_TITLE_LENGTH = 50

export type ConversationMessage = UIMessage

export interface Conversation {
  /** Unique identifier for the conversation */
  id: string
  /** Display title for the conversation */
  title: string
  /** Timestamp when the conversation was created (Unix ms) */
  createdAt: number
  /** Timestamp when the conversation was last updated (Unix ms) */
  updatedAt: number
  /** Array of messages in the conversation */
  messages: ConversationMessage[]
}

/**
 * Generate a unique conversation ID using the Web Crypto API.
 *
 * @returns A unique UUID v4 string
 *
 * @example
 * ```ts
 * const id = generateConversationId() // "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
 * ```
 */
export function generateConversationId(): string {
  return crypto.randomUUID()
}

/**
 * Generate a conversation title from the first user message.
 *
 * Extracts the first meaningful phrase from the message, strips markdown
 * formatting and special characters, and truncates to MAX_TITLE_LENGTH.
 *
 * @param message - The user message content to generate title from
 * @returns A sanitized, truncated title string
 *
 * @example
 * ```ts
 * generateTitleFromMessage("```sql\nSELECT * FROM users\n```")
 * // Returns: "SELECT * FROM users"
 *
 * generateTitleFromMessage("What is the query performance for...")
 * // Returns: "What is the query performance for"
 * ```
 */
export function generateTitleFromMessage(message: string): string {
  let cleaned = message.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')

  cleaned = cleaned
    .replace(/#{1,6}\s/g, '') // Headers
    .replace(/\*\*/g, '') // Bold
    .replace(/\*/g, '') // Italic
    .replace(/`/g, '') // Inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links

  const firstSentenceEnd = cleaned.search(/[.!?]\s/)
  if (firstSentenceEnd > 0 && firstSentenceEnd <= MAX_TITLE_LENGTH) {
    cleaned = cleaned.slice(0, firstSentenceEnd + 1)
  } else {
    cleaned = cleaned.slice(0, MAX_TITLE_LENGTH)
  }

  cleaned = cleaned.trim().replace(/^\s*[#*`-]+\s*/, '')

  // Ensure title is not empty
  if (!cleaned) {
    return 'New Conversation'
  }

  return cleaned
}

/**
 * A loosely-typed user/assistant message, matching the shapes produced by the
 * AI SDK runtime (`parts: [{ type: 'text', text }]`) and the legacy plain-text
 * format (`content: string` or `content: [{ text }]`).
 */
export interface TitleSourceMessage {
  role?: string
  parts?: unknown[]
  content?: string | Array<{ text?: string }>
}

/**
 * Extract the plain text of a message, regardless of whether it uses the AI SDK
 * `parts` array or the legacy `content` string / array form.
 *
 * @param message - The message to read text from
 * @returns The concatenated, trimmed text content (empty string if none)
 */
export function extractMessageText(
  message: TitleSourceMessage | undefined | null
): string {
  if (!message) return ''

  // AI SDK format: parts: [{ type: 'text', text: '...' }]
  if (Array.isArray(message.parts)) {
    const text = message.parts
      .filter(
        (part): part is { type: 'text'; text: string } =>
          !!part &&
          typeof part === 'object' &&
          'type' in part &&
          part.type === 'text' &&
          'text' in part &&
          typeof part.text === 'string'
      )
      .map((part) => part.text)
      .join(' ')
      .trim()
    if (text) return text
  }

  // Legacy plain-string content.
  if (typeof message.content === 'string') {
    return message.content.trim()
  }

  // Legacy array content: [{ text: '...' }].
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part?.text ?? '')
      .join(' ')
      .trim()
  }

  return ''
}

/**
 * Derive a conversation title from a message, but only when it is a user
 * message that contains text. Returns `undefined` otherwise so callers can skip
 * persisting a placeholder title.
 *
 * Reuses {@link generateTitleFromMessage} for the actual derivation, so the
 * D1 / Postgres and localStorage stores produce identical titles client-side
 * without an extra LLM call.
 *
 * @param message - The first user message in a conversation
 * @returns A derived title, or `undefined` when no title can be derived
 */
export function deriveTitleFromUserMessage(
  message: TitleSourceMessage | undefined | null
): string | undefined {
  if (!message || message.role !== 'user') return undefined
  const text = extractMessageText(message)
  return text ? generateTitleFromMessage(text) : undefined
}

/**
 * Whether a thread title is still the default placeholder (or absent) and
 * therefore eligible to be replaced by an auto-derived title.
 *
 * @param title - The current thread title (may be undefined)
 * @returns `true` when the title is missing or a known placeholder
 */
export function isUntitledThread(title: string | undefined | null): boolean {
  return !title || title === 'New Conversation' || title === 'New Chat'
}

/**
 * Format a timestamp as relative time or date string.
 *
 * Returns human-readable relative time for recent timestamps:
 * - < 1 minute: "just now"
 * - < 1 hour: "Xm ago"
 * - Today: "today at HH:MM"
 * - Yesterday: "yesterday at HH:MM"
 * - Older: "MMM DD" (e.g., "Jan 15")
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted time string
 *
 * @example
 * ```ts
 * // 30 seconds ago
 * formatRelativeTime(Date.now() - 30000) // "just now"
 *
 * // 45 minutes ago
 * formatRelativeTime(Date.now() - 2700000) // "45m ago"
 *
 * // 3 hours ago, today
 * formatRelativeTime(Date.now() - 10800000) // "today at 2:30 PM"
 *
 * // Yesterday
 * formatRelativeTime(Date.now() - 86400000) // "yesterday at 3:15 PM"
 *
 * // Last week
 * formatRelativeTime(Date.now() - 604800000) // "Mar 5"
 * ```
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  const date = new Date(timestamp)

  // Less than 1 minute
  if (diffSecs < 60) {
    return 'just now'
  }

  // Less than 1 hour
  if (diffMins < 60) {
    return `${diffMins}m ago`
  }

  const today = new Date()
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()

  if (isToday) {
    return `today at ${date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  }

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()

  if (isYesterday) {
    return `yesterday at ${date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  }

  // Less than a week ago, show days
  if (diffDays < 7) {
    return `${diffDays}d ago`
  }

  // Older than a week, show date
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Save conversations to localStorage.
 *
 * Serializes the conversations array to JSON and stores it under
 * the CONVERSATIONS_STORAGE_KEY.
 *
 * @param conversations - Array of conversations to persist
 *
 * @throws {Error} If localStorage is not available or quota exceeded
 *
 * @example
 * ```ts
 * const conversations: Conversation[] = [...]
 * saveConversations(conversations)
 * ```
 */
export function saveConversations(conversations: Conversation[]): void {
  try {
    const serialized = JSON.stringify(conversations)
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY, serialized)
  } catch (error) {
    // Silently fail if localStorage is unavailable (e.g., in SSR)
    // or if quota is exceeded
    if (error instanceof Error && error.name !== 'SecurityError') {
      console.error('Failed to save conversations:', error)
    }
  }
}

/**
 * Load conversations from localStorage.
 *
 * Deserializes and returns the stored conversations array.
 * Returns an empty array if:
 * - No conversations are stored
 * - localStorage is unavailable
 * - Stored data is invalid JSON
 *
 * @returns Array of stored conversations, or empty array if none exist
 *
 * @example
 * ```ts
 * const conversations = loadConversations()
 * // Returns: [{ id: "...", title: "...", messages: [...] }, ...]
 * ```
 */
export function loadConversations(): Conversation[] {
  try {
    const serialized = localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    if (!serialized) {
      return []
    }

    const parsed = JSON.parse(serialized) as unknown[]

    // Basic validation: ensure array of objects with required fields
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is Conversation =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        'title' in item &&
        'createdAt' in item &&
        'updatedAt' in item &&
        'messages' in item
    ) as Conversation[]
  } catch {
    // Return empty array on any error (parse error, localStorage unavailable)
    return []
  }
}

/**
 * Delete a specific conversation from localStorage.
 *
 * @param conversationId - ID of the conversation to delete
 *
 * @example
 * ```ts
 * deleteConversation('conv-123')
 * ```
 */
export function deleteConversation(conversationId: string): void {
  const conversations = loadConversations()
  const filtered = conversations.filter((c) => c.id !== conversationId)
  saveConversations(filtered)
}

/**
 * Update or add a conversation in localStorage.
 *
 * If a conversation with the same ID exists, it will be updated.
 * Otherwise, it will be added to the array.
 *
 * @param conversation - The conversation to upsert
 *
 * @example
 * ```ts
 * upsertConversation({
 *   id: 'conv-123',
 *   title: 'My Chat',
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   messages: [...]
 * })
 * ```
 */
export function upsertConversation(conversation: Conversation): void {
  const conversations = loadConversations()
  const index = conversations.findIndex((c) => c.id === conversation.id)

  if (index >= 0) {
    conversations[index] = conversation
  } else {
    conversations.push(conversation)
  }

  conversations.sort((a, b) => b.updatedAt - a.updatedAt)

  saveConversations(conversations)
}

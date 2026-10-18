import type { UIMessage } from 'ai'

const CONVERSATIONS_STORAGE_KEY = 'clickhouse-agent-conversations'

const MAX_TITLE_LENGTH = 50

export type ConversationMessage = UIMessage

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
}

export function generateConversationId(): string {
  return crypto.randomUUID()
}

export function generateTitleFromMessage(message: string): string {
  let cleaned = message.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')

  cleaned = cleaned
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  const firstSentenceEnd = cleaned.search(/[.!?]\s/)
  if (firstSentenceEnd > 0 && firstSentenceEnd <= MAX_TITLE_LENGTH) {
    cleaned = cleaned.slice(0, firstSentenceEnd + 1)
  } else {
    cleaned = cleaned.slice(0, MAX_TITLE_LENGTH)
  }

  cleaned = cleaned.trim().replace(/^\s*[#*`-]+\s*/, '')

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

export function extractMessageText(
  message: TitleSourceMessage | undefined | null
): string {
  if (!message) return ''

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

// Reuses generateTitleFromMessage so the D1/Postgres and localStorage stores produce identical titles client-side, with no LLM call.
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
 */
export function isUntitledThread(title: string | undefined | null): boolean {
  return !title || title === 'New Conversation' || title === 'New Chat'
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  const date = new Date(timestamp)

  if (diffSecs < 60) {
    return 'just now'
  }

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

  if (diffDays < 7) {
    return `${diffDays}d ago`
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

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

export function loadConversations(): Conversation[] {
  try {
    const serialized = localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    if (!serialized) {
      return []
    }

    const parsed = JSON.parse(serialized) as unknown[]

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
    return []
  }
}

export function deleteConversation(conversationId: string): void {
  const conversations = loadConversations()
  const filtered = conversations.filter((c) => c.id !== conversationId)
  saveConversations(filtered)
}

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

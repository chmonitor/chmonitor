/**
 * Backend-agnostic conversation export.
 *
 * Works over the common {@link ConversationStore} read interface (`list` +
 * `get`), so every backend (D1, Postgres, memory, browser, AgentState) and any
 * future one is exportable without special-casing. Scoped to one user: the
 * store only ever returns that user's conversations.
 */

import type { ConversationStore } from './types'

/** Upper bound on conversations exported in one call. */
export const EXPORT_MAX_CONVERSATIONS = 1000

/**
 * Yield one JSON line per conversation (metadata + messages), newline
 * terminated. Conversations that disappear between `list` and `get` are skipped.
 */
export async function* exportConversationsJsonl(
  store: ConversationStore,
  userId: string,
  opts: { limit?: number; sinceMs?: number } = {}
): AsyncGenerator<string> {
  const metas = await store.list(
    userId,
    opts.limit ?? EXPORT_MAX_CONVERSATIONS,
    opts.sinceMs
  )
  for (const meta of metas) {
    const conversation = await store.get(userId, meta.id)
    if (conversation) yield `${JSON.stringify(conversation)}\n`
  }
}

'use client'

/**
 * Selects the conversation-history backend for the assistant-ui agent.
 *
 * - Cloudflare Workers deployments with `VITE_FEATURE_CONVERSATION_DB`
 *   enabled persist threads server-side in D1 / Postgres.
 * - Everything else (self-hosted Docker, where the ClickHouse connection is
 *   typically read-only) persists threads in the browser's localStorage.
 *
 * Both backends implement the same `RemoteThreadListAdapter` contract, so the
 * runtime provider is agnostic to which one is active.
 */

import type { RemoteThreadListAdapter } from '@assistant-ui/react'

import { createD1ThreadListAdapter } from '@/lib/conversation-store/adapter/d1-thread-list-adapter'
import { createLocalThreadListAdapter } from '@/lib/conversation-store/adapter/local-thread-list-adapter'
import { featureFlags } from '@/lib/feature-flags'

export type ConversationBackend = 'd1' | 'local'

/**
 * Returns `'d1'` when server-side conversation storage is enabled, otherwise
 * `'local'`. Exposed separately so the UI can surface where history lives.
 */
export function resolveConversationBackend(options?: {
  persistRemote?: boolean
}): ConversationBackend {
  if (options?.persistRemote === false) return 'local'
  try {
    return featureFlags.conversationDb() ? 'd1' : 'local'
  } catch {
    return 'local'
  }
}

/**
 * Build the active `RemoteThreadListAdapter` for the current deployment.
 * Cloud unsigned visitors stay on local threads — conversation APIs are Clerk-only.
 */
export function resolveThreadListAdapter(options?: {
  persistRemote?: boolean
}): RemoteThreadListAdapter {
  return resolveConversationBackend(options) === 'd1'
    ? createD1ThreadListAdapter()
    : createLocalThreadListAdapter()
}

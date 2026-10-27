'use client'

/**
 * Selects the conversation-history backend for the assistant-ui agent.
 *
 * - When the server reports `conversations.dbStorageEnabled` on
 *   `/api/v1/config` (runtime `CHM_FEATURE_CONVERSATION_DB` plus a Clerk or
 *   trusted-proxy identity), threads persist server-side in D1 / Postgres /
 *   AgentState.
 * - Everything else persists threads in the browser's localStorage.
 *
 * Both backends implement the same `RemoteThreadListAdapter` contract, so the
 * runtime provider is agnostic to which one is active.
 */

import type { RemoteThreadListAdapter } from '@assistant-ui/react'

import { createD1ThreadListAdapter } from '@/lib/conversation-store/adapter/d1-thread-list-adapter'
import { createLocalThreadListAdapter } from '@/lib/conversation-store/adapter/local-thread-list-adapter'

export type ConversationBackend = 'd1' | 'local'

export interface ConversationBackendOptions {
  /** Runtime `conversations.dbStorageEnabled` from `/api/v1/config`. */
  dbStorageEnabled?: boolean
  /** False keeps threads local (cloud anonymous visitors). */
  persistRemote?: boolean
}

/**
 * Returns `'d1'` when server-side conversation storage is enabled, otherwise
 * `'local'`. Exposed separately so the UI can surface where history lives.
 */
export function resolveConversationBackend(
  options?: ConversationBackendOptions
): ConversationBackend {
  if (options?.persistRemote === false) return 'local'
  return options?.dbStorageEnabled === true ? 'd1' : 'local'
}

/**
 * Build the active `RemoteThreadListAdapter` for the current deployment.
 * Cloud unsigned visitors stay on local threads — they have no identity.
 */
export function resolveThreadListAdapter(
  options?: ConversationBackendOptions
): RemoteThreadListAdapter {
  return resolveConversationBackend(options) === 'd1'
    ? createD1ThreadListAdapter()
    : createLocalThreadListAdapter()
}

import type { ConversationStore } from './types'

import { AgentStateStore } from './agentstate-store'
import { BrowserStore } from './browser-store'
import { D1Store } from './d1-store'
import { MemoryStore } from './memory-store'
import { isConversationDbEnabled } from './server-feature'
import { ConversationStoreError } from './types'
// PostgresStore is NOT statically imported: the `postgres` package is
// Node-only and must NOT be bundled into the Cloudflare Workers build.
// It is loaded only at runtime via dynamic import when DATABASE_URL is set
// (i.e. a Node / non-CF environment). The CF path always reaches D1Store
// first and never hits this branch.
import { getPlatformBindings } from '@chm/platform'
import { getStatePostgresUrl } from '@/lib/state-backend/config'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'
const AGENTSTATE_API_KEY = 'AGENTSTATE_API_KEY'
const AGENTSTATE_BASE_URL = 'AGENTSTATE_BASE_URL'
const AGENTSTATE_AI_ENRICH = 'AGENTSTATE_AI_ENRICH'
const CONVERSATION_STORE_BACKEND = 'CONVERSATION_STORE_BACKEND'

/**
 * Resolves the appropriate conversation store implementation at runtime.
 *
 * Resolution priority:
 * 1. Feature flag disabled → BrowserStore (localStorage)
 * 2. AgentState (forced via CONVERSATION_STORE_BACKEND=agentstate, or when
 *    AGENTSTATE_API_KEY is set and no other backend is explicitly forced)
 * 3. D1 binding available → D1Store (Cloudflare D1)
 * 4. DATABASE_URL / POSTGRES_URL env var → PostgresStore
 * 5. No database config → MemoryStore with warning
 *
 * @returns Promise resolving to ConversationStore instance
 *
 * @example
 * ```ts
 * const store = await resolveStore()
 * await store.saveConversation('user-123', { messages: [] })
 * ```
 */
export async function resolveStore(): Promise<ConversationStore> {
  if (!isConversationDbEnabled()) {
    return new BrowserStore()
  }

  // Ahead of D1 so an explicit AgentState configuration wins even inside Cloudflare.
  const backend = process.env[CONVERSATION_STORE_BACKEND]
  const agentStateApiKey = process.env[AGENTSTATE_API_KEY]
  const otherBackendForced =
    backend === 'd1' || backend === 'postgres' || backend === 'memory'

  if (backend === 'agentstate' || (agentStateApiKey && !otherBackendForced)) {
    if (!agentStateApiKey) {
      throw new ConversationStoreError(
        'AGENTSTATE_API_KEY is required when CONVERSATION_STORE_BACKEND is set to "agentstate".',
        'VALIDATION_ERROR'
      )
    }

    return new AgentStateStore({
      apiKey: agentStateApiKey,
      baseUrl: process.env[AGENTSTATE_BASE_URL],
      aiEnrich: process.env[AGENTSTATE_AI_ENRICH] === 'true',
    })
  }

  try {
    const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)
    if (db) {
      return new D1Store()
    }
  } catch {}

  // Dynamic import keeps the `postgres` package out of the Cloudflare Workers
  // bundle — workerd never reaches this branch (D1 is resolved above).
  const postgresUrl = getStatePostgresUrl()
  if (postgresUrl) {
    const { PostgresStore } = await import('./postgres-store')
    return new PostgresStore(postgresUrl)
  }

  if (process.env.NODE_ENV === 'development' || process.env.CI) {
    console.warn(
      '[ConversationStore] No database configured (D1 binding or DATABASE_URL). ' +
        'Using MemoryStore - conversations will be lost on restart. ' +
        'Set DATABASE_URL or deploy to Cloudflare with D1 binding for persistence.'
    )
  }

  return new MemoryStore()
}

/**
 * Type guard to check if a store is persistent (D1, Postgres, or Browser).
 *
 * Note: PostgresStore is excluded from the static instanceof check because
 * it is dynamically imported to keep the `postgres` package out of the
 * Cloudflare Workers bundle. A store that is not MemoryStore is considered
 * persistent.
 *
 * @param store - ConversationStore instance
 * @returns true if store persists data beyond runtime
 */
export function isPersistentStore(store: ConversationStore): boolean {
  return (
    store instanceof D1Store ||
    store instanceof BrowserStore ||
    store instanceof AgentStateStore ||
    !(store instanceof MemoryStore)
  )
}

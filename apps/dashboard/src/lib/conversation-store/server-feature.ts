/**
 * Server-side detection of conversation database storage (#4227).
 *
 * Read from RUNTIME env so a published image (built with the flag off) can
 * turn persistence on with `CHM_FEATURE_CONVERSATION_DB=true`. Storage needs
 * a per-user identity: Clerk (with a secret key) or the `trusted` proxy
 * headers. Under `trusted` it also needs a durable backend, so trusted users
 * are never routed to the in-process MemoryStore.
 */

import { getPlatformBindings } from '@chm/platform'
import { type AuthProvider, getAuthProvider } from '@/lib/auth/provider'
import { parseDeploymentMode } from '@/lib/config/deployment-mode'
import { parseBool } from '@/lib/config/parse-bool'
import {
  getStatePostgresUrl,
  STATE_D1_BINDING,
} from '@/lib/state-backend/config'

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]
  }
  return undefined
}

function isFeatureFlagEnabled(): boolean {
  const value =
    readEnv('CHM_FEATURE_CONVERSATION_DB') ??
    readEnv('VITE_FEATURE_CONVERSATION_DB') ??
    import.meta.env?.VITE_FEATURE_CONVERSATION_DB
  // Explicit flag wins; otherwise default from the deployment profile.
  return (
    parseBool(value) ??
    parseDeploymentMode(readEnv('CHM_DEPLOYMENT_MODE')) === 'cloud'
  )
}

function resolveProvider(): AuthProvider | null {
  try {
    return getAuthProvider(readEnv)
  } catch {
    return null
  }
}

function hasPersistentBackend(): boolean {
  if (readEnv('AGENTSTATE_API_KEY')) return true
  try {
    if (getPlatformBindings().getD1Database(STATE_D1_BINDING)) return true
  } catch {
    // not Cloudflare
  }
  return Boolean(getStatePostgresUrl())
}

export type ConversationIdentity = 'clerk' | 'trusted'

export interface ConversationStoreServerConfig {
  dbStorageEnabled: boolean
  /** Identity source conversation routes resolve users with; null when off. */
  identity: ConversationIdentity | null
}

export function getConversationStoreServerConfig(): ConversationStoreServerConfig {
  const provider = resolveProvider()
  let identity: ConversationIdentity | null = null
  if (provider === 'clerk' && readEnv('CLERK_SECRET_KEY')) {
    identity = 'clerk'
  } else if (provider === 'trusted' && hasPersistentBackend()) {
    identity = 'trusted'
  }
  if (!identity || !isFeatureFlagEnabled()) {
    return { dbStorageEnabled: false, identity: null }
  }
  return { dbStorageEnabled: true, identity }
}

export function isConversationDbEnabled(): boolean {
  return getConversationStoreServerConfig().dbStorageEnabled
}

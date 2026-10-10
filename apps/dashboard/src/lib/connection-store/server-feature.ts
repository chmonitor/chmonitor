/**
 * Server-side detection of user-connections database storage availability.
 */

import { isEncryptionConfigured } from './crypto'
import { getPlatformBindings } from '@chm/platform'
import { type AuthProvider, getAuthProvider } from '@/lib/auth/provider'
import { parseDeploymentMode } from '@/lib/config/deployment-mode'
import { parseBool } from '@/lib/config/parse-bool'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'
const DATABASE_URL = 'DATABASE_URL'

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]
  }
  return undefined
}

function isFeatureFlagEnabled(): boolean {
  const value =
    readEnv('CHM_FEATURE_USER_CONNECTIONS_DB') ??
    readEnv('VITE_FEATURE_USER_CONNECTIONS_DB')
  // Explicit flag wins; otherwise default from the deployment profile so
  // `CHM_DEPLOYMENT_MODE=cloud` enables per-user connections without an extra flag.
  return (
    parseBool(value) ??
    parseDeploymentMode(readEnv('CHM_DEPLOYMENT_MODE')) === 'cloud'
  )
}

function isClerkAuth(): boolean {
  let provider: AuthProvider
  try {
    provider = getAuthProvider(readEnv)
  } catch {
    return false
  }
  return provider === 'clerk' && Boolean(readEnv('CLERK_SECRET_KEY'))
}

function hasDatabaseBackend(): boolean {
  try {
    const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)
    if (db) return true
  } catch {
    // not CF
  }
  return Boolean(
    readEnv(DATABASE_URL) ??
      readEnv('POSTGRES_URL') ??
      readEnv('POSTGRES_PRISMA_URL')
  )
}

export interface UserConnectionsServerConfig {
  dbStorageEnabled: boolean
  requiresAuth: boolean
  encryptionConfigured: boolean
}

export function getUserConnectionsServerConfig(): UserConnectionsServerConfig {
  const encryptionConfigured = isEncryptionConfigured()
  const requiresAuth = true
  const dbStorageEnabled =
    isFeatureFlagEnabled() &&
    isClerkAuth() &&
    hasDatabaseBackend() &&
    encryptionConfigured

  return { dbStorageEnabled, requiresAuth, encryptionConfigured }
}

export function assertUserConnectionsDbEnabled(): void {
  const config = getUserConnectionsServerConfig()
  if (!config.dbStorageEnabled) {
    throw new Error('User connections database storage is not enabled')
  }
}

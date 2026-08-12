/**
 * ClickHouse Connection Pool
 * Manages pooled ClickHouse clients using singleton pattern
 * Reuses existing clients instead of creating new ones for each request
 * Max 10 concurrent connections per client config
 */

import type { ClickHouseClient } from '@clickhouse/client'
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web'

import type { ClickHouseConfig } from './types'

import { debug } from '@chm/logger'

type PoolKey = string
export type PooledClient = {
  client: ClickHouseClient | WebClickHouseClient
  createdAt: number
  lastUsed: number
  inUse: number
}

export const clientPool = new Map<PoolKey, PooledClient>()
const MAX_POOL_SIZE = Number(process.env.CLICKHOUSE_POOL_SIZE) || 10
const CLIENT_TIMEOUT =
  Number(process.env.CLICKHOUSE_POOL_TIMEOUT) || 5 * 60 * 1000
const CLEANUP_INTERVAL =
  Number(process.env.CLICKHOUSE_POOL_CLEANUP_INTERVAL) || 60 * 1000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startPeriodicCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(cleanupStaleClients, CLEANUP_INTERVAL)
  // Don't prevent process from exiting
  if (
    cleanupTimer &&
    typeof cleanupTimer === 'object' &&
    'unref' in cleanupTimer
  ) {
    cleanupTimer.unref()
  }
}

/**
 * Short, non-reversible digest (FNV-1a 32-bit) used to fingerprint a secret
 * inside a pool key. Deliberately dependency-free and synchronous — the
 * WebCrypto digest API is async and `node:crypto` is unavailable on Workers.
 * It is a change detector, not a security primitive.
 */
function secretFingerprint(secret: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < secret.length; i++) {
    hash ^= secret.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Generate a pool key from client configuration and web flag
 */
export function getPoolKey(config: ClickHouseConfig, web: boolean): PoolKey {
  // The password is part of the client's identity: without it, two configs
  // sharing host+user+web+db collide, so a rotated CLICKHOUSE_PASSWORD kept
  // reusing the client built with the OLD credentials (issue #2945). Only the
  // digest goes into the key — the key itself is debug-logged below.
  const pw = secretFingerprint(config.password ?? '')
  const base = `${config.host}:${config.user}:${web}:pw=${pw}`
  // Scope a distinct pooled client per default database.
  return config.database ? `${base}:db=${config.database}` : base
}

/**
 * Cleanup stale clients from the pool
 */
export function cleanupStaleClients(): void {
  const now = Date.now()
  const staleKeys: PoolKey[] = []

  for (const [key, pooled] of clientPool.entries()) {
    if (now - pooled.lastUsed > CLIENT_TIMEOUT && pooled.inUse === 0) {
      staleKeys.push(key)
    }
  }

  for (const key of staleKeys) {
    clientPool.delete(key)
    debug(`[Connection Pool] Cleaned up stale client: ${key}`)
  }
}

/**
 * Get or create a pooled client
 */
export function getPooledClient(
  client: ClickHouseClient | WebClickHouseClient,
  config: ClickHouseConfig,
  web: boolean
): PooledClient {
  const key = getPoolKey(config, web)
  let pooled = clientPool.get(key)

  if (!pooled) {
    pooled = {
      client,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      inUse: 0,
    }
    clientPool.set(key, pooled)
    debug(`[Connection Pool] Created new client: ${key}`)
  } else {
    pooled.lastUsed = Date.now()
  }

  startPeriodicCleanup()

  return pooled
}

/**
 * Get memory usage stats for the connection pool
 */
export function getConnectionPoolStats() {
  const clients = Array.from(clientPool.entries()).map(([key, pooled]) => ({
    key,
    inUse: pooled.inUse,
    idleMs: Date.now() - pooled.lastUsed,
    ageMs: Date.now() - pooled.createdAt,
  }))

  return {
    poolSize: clientPool.size,
    maxPoolSize: MAX_POOL_SIZE,
    totalInUse: clients.reduce((sum, c) => sum + c.inUse, 0),
    totalIdle: clients.filter((c) => c.inUse === 0).length,
    clients,
    config: {
      maxPoolSize: MAX_POOL_SIZE,
      clientTimeoutMs: CLIENT_TIMEOUT,
      cleanupIntervalMs: CLEANUP_INTERVAL,
    },
  }
}

export interface BrowserConnection {
  id: string // UUID
  hostId: number // negative integer (-1, -2, ...)
  name: string // display name
  host: string // full URL e.g. https://my.clickhouse.cloud:8443
  user: string
  password: string // stored in localStorage
  createdAt: string // ISO timestamp
  updatedAt: string
}

export const BROWSER_CONNECTIONS_STORAGE_KEY =
  'clickhouse-monitor-browser-connections'

/**
 * Next hostId for a new browser connection: one below the smallest existing
 * (negative) hostId, so browser connections never collide with env hosts
 * (indexed 0, 1, 2, …). Pure and deterministic — callers derive the id from the
 * current connection list rather than reading it back out of a React updater.
 */
export function nextBrowserConnectionHostId(
  connections: readonly Pick<BrowserConnection, 'hostId'>[]
): number {
  return Math.min(...connections.map((c) => c.hostId), 0) - 1
}

/** Encrypted storage envelope (version 2). */
export interface EncryptedBrowserConnectionsStore {
  version: 2
  encrypted: string
}

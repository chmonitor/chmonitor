import type { SourceEngine } from '@chm/types'

export interface BrowserConnection {
  id: string // UUID
  hostId: number // negative integer (-1, -2, ...)
  name: string // display name
  host: string // ClickHouse: full URL; Postgres: bare hostname/IP
  user: string
  password: string // stored in localStorage
  createdAt: string // ISO timestamp
  updatedAt: string
  /**
   * Source engine (phase 2, #2449). Absent on pre-Postgres rows → treated as
   * `'clickhouse'` by every reader. The whole object is encrypted as-is
   * (browser-crypto envelope v2), so adding these optional fields needs no
   * serialization change.
   */
  engine?: SourceEngine
  /** Postgres-only: TCP port (default 5432). */
  port?: number
  /** Postgres-only: database name. */
  database?: string
  /** Postgres-only: libpq `sslmode` (`disable` | `require` | `verify-full`). */
  sslmode?: string
  /**
   * Optional PeerDB monitoring link (any engine) — mirrors the server envelope
   * (`ConnectionCredentials`). Encrypted as-is with the rest of the object
   * (browser-crypto envelope v2), so these optional fields need no serialization
   * change. The secret stays inside the encrypted blob only.
   */
  peerdbApiUrl?: string
  /** PeerDB auth scheme: `basic` (empty-user password) or `bearer` (API token). */
  peerdbAuthScheme?: 'basic' | 'bearer'
  /** PeerDB Basic password or Bearer token. Absent ⇒ an open (auth-less) flow-api. */
  peerdbAuthSecret?: string
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

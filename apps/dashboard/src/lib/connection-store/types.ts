/**
 * User connection storage types for per-user host credentials.
 */

import type { SourceEngine } from '@chm/types'

/**
 * Credential-envelope discriminator (v2). ABSENT on v1 payloads — which only
 * ever held ClickHouse creds — so a decrypted v1 blob (no `kind`) reads back as
 * `'clickhouse'`. Keep this aligned with the browser envelope in
 * `lib/connection-crypto/browser-crypto.ts` (both JSON-serialize this shape).
 */
export type ConnectionKind = 'clickhouse' | 'postgres'

/**
 * Encrypted-at-rest connection credentials.
 *
 * **Envelope v1** (legacy, ClickHouse only): `{ host, user, password }` where
 * `host` is a full ClickHouse URL. Decodes unchanged — `kind` is `undefined`,
 * treated as `'clickhouse'`.
 *
 * **Envelope v2** (adds Postgres): carries `kind` plus the Postgres-only fields
 * (`port`, `database`, `sslmode`). For a Postgres source `host` is a BARE
 * hostname/IP (no scheme) and the TCP endpoint is `host:port`.
 *
 * The AES-GCM binary VERSION byte is unchanged — envelope versioning lives at
 * this JSON-schema level, so old ciphertext round-trips without a re-key.
 */
export interface ConnectionCredentials {
  /** Envelope discriminator; absent (v1) ⇒ `'clickhouse'`. */
  kind?: ConnectionKind
  host: string
  user: string
  password: string
  /** Postgres TCP port (v2, Postgres only). */
  port?: number
  /** Postgres database name (v2, Postgres only). */
  database?: string
  /** libpq `sslmode` (v2, Postgres only): `disable` | `require` | `verify-full`. */
  sslmode?: string
  /**
   * Optional PeerDB monitoring link (any engine). Attaches a PeerDB flow-api
   * deployment to this connection so the /peerdb pages can read CDC mirrors via
   * `?connection=<id>` instead of the single env-wide `PEERDB_API_URL`. Flat
   * optional fields mirror the Postgres precedent (`port`/`database`/`sslmode`)
   * so old ciphertext round-trips without a re-key. The secret lives ONLY here
   * in the encrypted payload — list APIs never return it.
   */
  peerdbApiUrl?: string
  /** PeerDB auth scheme: `basic` (empty-user password) or `bearer` (API token). */
  peerdbAuthScheme?: 'basic' | 'bearer'
  /** PeerDB Basic password or Bearer token. Absent ⇒ an open (auth-less) flow-api. */
  peerdbAuthSecret?: string
}

/** Public-facing connection metadata (no password). */
export interface UserConnectionMeta {
  id: string
  userId: string
  name: string
  hostUrl: string
  chUser: string
  hostId: number
  /**
   * Source engine. Fail-closed: legacy rows (pre-`engine` column) and any
   * unset value resolve to `'clickhouse'` — see `parseSourceEngine`.
   */
  engine: SourceEngine
  createdAt: number
  updatedAt: number
}

/** Full stored connection including encrypted payload. */
export interface StoredUserConnection extends UserConnectionMeta {
  encryptedPayload: string
}

export interface CreateUserConnectionInput {
  name: string
  hostUrl: string
  chUser: string
  credentials: ConnectionCredentials
  /** Source engine; omit to default to `'clickhouse'` (the store applies it). */
  engine?: SourceEngine
}

/**
 * Atomic host-limit enforcement inputs for `create()`. The store folds the
 * "is there room for one more?" count check into the same SQL statement as
 * the row insert, so a second concurrent request can't slip through the gap
 * between a separate pre-check and the insert (TOCTOU).
 *
 * `memberUserIds` is the full set of user_ids whose connections count toward
 * the limit — just `[userId]` for a user-owned plan, or the pooled Clerk org
 * member id list for an org-owned plan (see `countOwnerHosts`). `limit` is
 * the plan's host cap; `null` means unlimited and skips enforcement entirely.
 */
export interface CreateLimitEnforcement {
  memberUserIds: string[]
  limit: number | null
}

export interface UpdateUserConnectionInput {
  name?: string
  hostUrl?: string
  chUser?: string
  credentials?: ConnectionCredentials
}

export interface ConnectionStore {
  list(userId: string): Promise<UserConnectionMeta[]>
  get(
    userId: string,
    connectionId: string
  ): Promise<StoredUserConnection | null>
  /**
   * `limit` (optional) enforces the plan's host cap atomically with the
   * insert — see {@link CreateLimitEnforcement}. Omit it (or pass
   * `limit: null`) to insert unconditionally, e.g. for unlimited plans.
   * Throws `ConnectionStoreError('LIMIT_EXCEEDED')` when the cap is already
   * met at insert time, even if a caller's earlier pre-check passed.
   */
  create(
    userId: string,
    input: CreateUserConnectionInput,
    limit?: CreateLimitEnforcement
  ): Promise<UserConnectionMeta>
  update(
    userId: string,
    connectionId: string,
    input: UpdateUserConnectionInput
  ): Promise<UserConnectionMeta>
  delete(userId: string, connectionId: string): Promise<void>
  getCredentials(
    userId: string,
    connectionId: string
  ): Promise<ConnectionCredentials | null>
}

export class ConnectionStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'UNAUTHORIZED'
      | 'STORAGE_ERROR'
      | 'VALIDATION_ERROR'
      | 'NOT_CONFIGURED'
      | 'LIMIT_EXCEEDED',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ConnectionStoreError'
  }
}

/** Database-backed user connections use hostId <= -1000. */
export const DB_CONNECTION_HOST_ID_START = -1000

export function allocateDbHostId(existingHostIds: number[]): number {
  const dbIds = existingHostIds.filter(
    (id) => id <= DB_CONNECTION_HOST_ID_START
  )
  if (dbIds.length === 0) return DB_CONNECTION_HOST_ID_START
  return Math.min(...dbIds) - 1
}

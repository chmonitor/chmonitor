/**
 * User connection storage types for per-user host credentials.
 */

import type { SourceEngine } from '@chm/types'

export interface ConnectionCredentials {
  host: string
  user: string
  password: string
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

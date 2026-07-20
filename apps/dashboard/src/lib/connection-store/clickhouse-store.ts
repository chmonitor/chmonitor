/**
 * ClickHouse-backed connection store (server-only, self-hosted OSS).
 *
 * Lets an operator persist per-user connections in their own ClickHouse
 * instead of Cloudflare D1 or Postgres. Configured via `CHM_STATE_CLICKHOUSE_*`
 * (see `lib/state-backend/config.ts`); resolved by `resolve-store.ts` after
 * D1 and before Postgres.
 *
 * Storage model: one `${prefix}user_connections` table on
 * `ReplacingMergeTree(updated_at)` keyed `(user_id, id)` — updates are plain
 * inserts with a newer `updated_at`, reads use `FINAL` for
 * read-your-writes correctness, deletes are lightweight `DELETE FROM`.
 */

import type { StateClickHouseConfig } from '@/lib/state-backend/config'
import type {
  ConnectionStore,
  CreateLimitEnforcement,
  CreateUserConnectionInput,
  StoredUserConnection,
  UpdateUserConnectionInput,
  UserConnectionMeta,
} from './types'

import { decryptCredentials, encryptCredentials } from './crypto'
import { allocateDbHostId, ConnectionStoreError } from './types'
import { DEFAULT_SOURCE_ENGINE, parseSourceEngine } from '@chm/types'
import {
  StateClickHouseClient,
  type StateClickHouseExecutor,
} from '@/lib/state-backend/clickhouse-client'

interface ClickHouseUserConnectionRow {
  id: string
  user_id: string
  name: string
  host_url: string
  ch_user: string
  host_id: number
  engine: string
  encrypted_payload: string
  created_at: number
  updated_at: number
}

/** Exported for SQL-generation tests. */
export function buildConnectionsDdl(database: string, prefix: string): string {
  return `CREATE TABLE IF NOT EXISTS ${database}.${prefix}user_connections (
  id String,
  user_id String,
  name String,
  host_url String,
  ch_user String,
  host_id Int64,
  engine String DEFAULT 'clickhouse',
  encrypted_payload String,
  created_at Int64,
  updated_at Int64
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, id)`
}

const COLUMNS =
  'id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at'

function rowToMeta(row: ClickHouseUserConnectionRow): UserConnectionMeta {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    hostUrl: row.host_url,
    chUser: row.ch_user,
    hostId: Number(row.host_id),
    engine: parseSourceEngine(row.engine),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export class ClickHouseConnectionStore implements ConnectionStore {
  private readonly client: StateClickHouseExecutor
  private readonly table: string
  private readonly database: string
  private readonly prefix: string
  private initialized = false

  constructor(config: StateClickHouseConfig, client?: StateClickHouseExecutor) {
    this.client = client ?? new StateClickHouseClient(config)
    this.database = config.database
    this.prefix = config.tablePrefix
    this.table = `${config.database}.${config.tablePrefix}user_connections`
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.client.command(`CREATE DATABASE IF NOT EXISTS ${this.database}`)
    await this.client.command(buildConnectionsDdl(this.database, this.prefix))
    this.initialized = true
  }

  private async insertRow(row: ClickHouseUserConnectionRow): Promise<void> {
    await this.client.command(
      `INSERT INTO ${this.table} (${COLUMNS}) VALUES
        ({id:String}, {user_id:String}, {name:String}, {host_url:String}, {ch_user:String},
         {host_id:Int64}, {engine:String}, {encrypted_payload:String}, {created_at:Int64}, {updated_at:Int64})`,
      { ...row }
    )
  }

  async list(userId: string): Promise<UserConnectionMeta[]> {
    await this.ensureInitialized()
    const rows = await this.client.query<ClickHouseUserConnectionRow>(
      `SELECT ${COLUMNS} FROM ${this.table} FINAL
       WHERE user_id = {user_id:String} ORDER BY created_at ASC`,
      { user_id: userId }
    )
    return rows.map(rowToMeta)
  }

  async get(
    userId: string,
    connectionId: string
  ): Promise<StoredUserConnection | null> {
    await this.ensureInitialized()
    const rows = await this.client.query<ClickHouseUserConnectionRow>(
      `SELECT ${COLUMNS} FROM ${this.table} FINAL
       WHERE user_id = {user_id:String} AND id = {id:String} LIMIT 1`,
      { user_id: userId, id: connectionId }
    )
    const row = rows[0]
    if (!row) return null
    return { ...rowToMeta(row), encryptedPayload: row.encrypted_payload }
  }

  async create(
    userId: string,
    input: CreateUserConnectionInput,
    limit?: CreateLimitEnforcement
  ): Promise<UserConnectionMeta> {
    await this.ensureInitialized()

    // Best-effort limit check. ClickHouse has no transactions/advisory locks,
    // so unlike the Postgres store this pre-check is not race-proof under
    // concurrent creates — acceptable for the self-hosted OSS path this
    // backend targets (single operator, no billing enforcement stakes).
    if (limit && limit.limit != null && limit.memberUserIds.length > 0) {
      const memberIds = JSON.stringify(limit.memberUserIds)
      const rows = await this.client.query<{ cnt: string | number }>(
        `SELECT count() AS cnt FROM ${this.table} FINAL
         WHERE has(JSONExtract({member_ids:String}, 'Array(String)'), user_id)`,
        { member_ids: memberIds }
      )
      const count = Number(rows[0]?.cnt ?? 0)
      if (count >= limit.limit) {
        throw new ConnectionStoreError('Host limit reached', 'LIMIT_EXCEEDED')
      }
    }

    const existing = await this.list(userId)
    const now = Date.now()
    const id = crypto.randomUUID()
    const hostId = allocateDbHostId(existing.map((c) => c.hostId))
    const engine = input.engine ?? DEFAULT_SOURCE_ENGINE
    const encryptedPayload = await encryptCredentials(input.credentials)

    await this.insertRow({
      id,
      user_id: userId,
      name: input.name,
      host_url: input.hostUrl,
      ch_user: input.chUser,
      host_id: hostId,
      engine,
      encrypted_payload: encryptedPayload,
      created_at: now,
      updated_at: now,
    })

    return {
      id,
      userId,
      name: input.name,
      hostUrl: input.hostUrl,
      chUser: input.chUser,
      hostId,
      engine,
      createdAt: now,
      updatedAt: now,
    }
  }

  async update(
    userId: string,
    connectionId: string,
    input: UpdateUserConnectionInput
  ): Promise<UserConnectionMeta> {
    const existing = await this.get(userId, connectionId)
    if (!existing) {
      throw new ConnectionStoreError('Connection not found', 'NOT_FOUND')
    }

    const now = Date.now()
    const name = input.name ?? existing.name
    const hostUrl = input.hostUrl ?? existing.hostUrl
    const chUser = input.chUser ?? existing.chUser

    let encryptedPayload = existing.encryptedPayload
    if (input.credentials) {
      encryptedPayload = await encryptCredentials(input.credentials)
    } else if (input.hostUrl || input.chUser) {
      const current = await decryptCredentials(existing.encryptedPayload)
      encryptedPayload = await encryptCredentials({
        host: hostUrl,
        user: chUser,
        password: current.password,
      })
    }

    // ReplacingMergeTree "update": insert the full row with a newer version.
    await this.insertRow({
      id: existing.id,
      user_id: existing.userId,
      name,
      host_url: hostUrl,
      ch_user: chUser,
      host_id: existing.hostId,
      engine: existing.engine,
      encrypted_payload: encryptedPayload,
      created_at: existing.createdAt,
      updated_at: now,
    })

    return { ...existing, name, hostUrl, chUser, updatedAt: now }
  }

  async delete(userId: string, connectionId: string): Promise<void> {
    const existing = await this.get(userId, connectionId)
    if (!existing) {
      throw new ConnectionStoreError('Connection not found', 'NOT_FOUND')
    }
    await this.client.command(
      `DELETE FROM ${this.table} WHERE user_id = {user_id:String} AND id = {id:String}`,
      { user_id: userId, id: connectionId }
    )
  }

  async getCredentials(userId: string, connectionId: string) {
    const stored = await this.get(userId, connectionId)
    if (!stored) return null
    return decryptCredentials(stored.encryptedPayload)
  }
}

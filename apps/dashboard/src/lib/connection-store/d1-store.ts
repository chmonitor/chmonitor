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
import { getPlatformBindings } from '@chm/platform'
import { DEFAULT_SOURCE_ENGINE, parseSourceEngine } from '@chm/types'

interface D1UserConnectionRow {
  id: string
  user_id: string
  name: string
  host_url: string
  ch_user: string
  host_id: number
  engine: string | null
  encrypted_payload: string
  created_at: number
  updated_at: number
}

function rowToMeta(row: D1UserConnectionRow): UserConnectionMeta {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    hostUrl: row.host_url,
    chUser: row.ch_user,
    hostId: row.host_id,
    engine: parseSourceEngine(row.engine),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class D1ConnectionStore implements ConnectionStore {
  private getDb(): D1Database {
    const db = getPlatformBindings().getD1Database('CHM_CLOUD_D1')
    if (!db) {
      throw new ConnectionStoreError(
        'CHM_CLOUD_D1 binding not found',
        'STORAGE_ERROR'
      )
    }
    return db
  }

  async list(userId: string): Promise<UserConnectionMeta[]> {
    const db = this.getDb()
    const result = await db
      .prepare(
        `SELECT id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at
         FROM user_connections WHERE user_id = ?1 ORDER BY created_at ASC`
      )
      .bind(userId)
      .all<D1UserConnectionRow>()

    return (result.results ?? []).map(rowToMeta)
  }

  async get(
    userId: string,
    connectionId: string
  ): Promise<StoredUserConnection | null> {
    const db = this.getDb()
    const row = await db
      .prepare(
        `SELECT id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at
         FROM user_connections WHERE user_id = ?1 AND id = ?2`
      )
      .bind(userId, connectionId)
      .first<D1UserConnectionRow>()

    if (!row) return null

    return {
      ...rowToMeta(row),
      encryptedPayload: row.encrypted_payload,
    }
  }

  async create(
    userId: string,
    input: CreateUserConnectionInput,
    limit?: CreateLimitEnforcement
  ): Promise<UserConnectionMeta> {
    const db = this.getDb()
    const existing = await this.list(userId)
    const now = Date.now()
    const id = crypto.randomUUID()
    const hostId = allocateDbHostId(existing.map((c) => c.hostId))
    const engine = input.engine ?? DEFAULT_SOURCE_ENGINE
    const encryptedPayload = await encryptCredentials(input.credentials)
    const insertValues = [
      id,
      userId,
      input.name,
      input.hostUrl,
      input.chUser,
      hostId,
      engine,
      encryptedPayload,
      now,
      now,
    ]

    // D1 statements are individually ACID, but the count-then-insert pattern
    // is still a TOCTOU race across two round trips: two concurrent requests
    // can both read a count under the cap before either has inserted. Folding
    // the count check into the INSERT's own SELECT collapses both steps into
    // ONE statement, so there's no window for a second request to interleave.
    // A capped plan gets `INSERT ... SELECT ... WHERE <count> < <limit>`; the
    // SELECT (and therefore the insert) evaluates against the row set as it
    // stands at that single statement's execution, so only one of two racing
    // requests can ever observe room under the cap and insert.
    if (limit && limit.limit != null && limit.memberUserIds.length > 0) {
      const memberPlaceholders = limit.memberUserIds
        .map((_, i) => `?${insertValues.length + i + 1}`)
        .join(', ')
      const limitParamIndex =
        insertValues.length + limit.memberUserIds.length + 1

      const result = await db
        .prepare(
          `INSERT INTO user_connections
           (id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
           WHERE (SELECT COUNT(*) FROM user_connections WHERE user_id IN (${memberPlaceholders})) < ?${limitParamIndex}`
        )
        .bind(...insertValues, ...limit.memberUserIds, limit.limit)
        .run()

      if ((result.meta.changes ?? 0) === 0) {
        throw new ConnectionStoreError('Host limit reached', 'LIMIT_EXCEEDED')
      }
    } else {
      await db
        .prepare(
          `INSERT INTO user_connections
           (id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
        )
        .bind(...insertValues)
        .run()
    }

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

    const db = this.getDb()
    await db
      .prepare(
        `UPDATE user_connections
         SET name = ?1, host_url = ?2, ch_user = ?3, encrypted_payload = ?4, updated_at = ?5
         WHERE user_id = ?6 AND id = ?7`
      )
      .bind(name, hostUrl, chUser, encryptedPayload, now, userId, connectionId)
      .run()

    return {
      ...existing,
      name,
      hostUrl,
      chUser,
      updatedAt: now,
    }
  }

  async delete(userId: string, connectionId: string): Promise<void> {
    const db = this.getDb()
    const result = await db
      .prepare(`DELETE FROM user_connections WHERE user_id = ?1 AND id = ?2`)
      .bind(userId, connectionId)
      .run()

    if ((result.meta.changes ?? 0) === 0) {
      throw new ConnectionStoreError('Connection not found', 'NOT_FOUND')
    }
  }

  async getCredentials(
    userId: string,
    connectionId: string
  ): Promise<import('./types').ConnectionCredentials | null> {
    const stored = await this.get(userId, connectionId)
    if (!stored) return null
    return decryptCredentials(stored.encryptedPayload)
  }
}

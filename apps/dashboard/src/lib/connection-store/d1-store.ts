import type {
  ConnectionStore,
  CreateLimitEnforcement,
  CreateUserConnectionInput,
  StoredUserConnection,
  UpdateUserConnectionInput,
  UserConnectionMeta,
} from './types'

import { decryptCredentials, encryptCredentials } from './crypto'
import { ConnectionStoreError, DB_CONNECTION_HOST_ID_START } from './types'
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
    const now = Date.now()
    const id = crypto.randomUUID()
    const engine = input.engine ?? DEFAULT_SOURCE_ENGINE
    const encryptedPayload = await encryptCredentials(input.credentials)
    const insertValues = [
      id,
      userId,
      input.name,
      input.hostUrl,
      input.chUser,
      engine,
      encryptedPayload,
      now,
      now,
      DB_CONNECTION_HOST_ID_START,
    ]

    // host_id is allocated INSIDE the insert statement (issue #2676): a JS-side
    // `list() → allocateDbHostId() → INSERT` sequence is a TOCTOU race — two
    // concurrent creates can both read the same snapshot and insert the SAME
    // host_id, silently aliasing two different connections under one `?host=N`
    // slot. Computed in the statement itself, the subquery evaluates against
    // the row set as it stands at that single statement's execution (D1
    // statements are individually ACID), so racing creates always observe each
    // other's rows and allocate distinct ids. The unique index on
    // (user_id, host_id) — migration 0023 — is the backstop.
    // Semantics mirror allocateDbHostId (types.ts): first DB connection gets
    // DB_CONNECTION_HOST_ID_START (?10), later ones min(existing) - 1.
    const hostIdAllocSql = `COALESCE((SELECT MIN(host_id) FROM user_connections WHERE user_id = ?2 AND host_id <= ?10), ?10 + 1) - 1`

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
           SELECT ?1, ?2, ?3, ?4, ?5, ${hostIdAllocSql}, ?6, ?7, ?8, ?9
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
           SELECT ?1, ?2, ?3, ?4, ?5, ${hostIdAllocSql}, ?6, ?7, ?8, ?9`
        )
        .bind(...insertValues)
        .run()
    }

    // The allocated host_id only exists in the database — read it back off the
    // row we just inserted (keyed by our own UUID, so this is race-free).
    const created = await db
      .prepare(`SELECT host_id FROM user_connections WHERE id = ?1`)
      .bind(id)
      .first<{ host_id: number }>()
    if (!created || typeof created.host_id !== 'number') {
      throw new ConnectionStoreError(
        'Failed to read back created connection',
        'STORAGE_ERROR'
      )
    }

    return {
      id,
      userId,
      name: input.name,
      hostUrl: input.hostUrl,
      chUser: input.chUser,
      hostId: created.host_id,
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

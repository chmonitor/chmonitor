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
import postgres from 'postgres'

interface PostgresUserConnectionRow {
  id: string
  user_id: string
  name: string
  host_url: string
  ch_user: string
  host_id: number
  engine: string | null
  encrypted_payload: string
  created_at: string
  updated_at: string
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS user_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host_url TEXT NOT NULL,
  ch_user TEXT NOT NULL,
  host_id INTEGER NOT NULL,
  engine TEXT NOT NULL DEFAULT 'clickhouse',
  encrypted_payload TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Idempotently add the engine column to tables created before phase 1 (#2448).
ALTER TABLE user_connections
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'clickhouse';

CREATE INDEX IF NOT EXISTS idx_user_connections_user_id
  ON user_connections(user_id);

CREATE TABLE IF NOT EXISTS connection_sessions (
  token TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  user_id TEXT,
  fingerprint TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connection_sessions_expires
  ON connection_sessions(expires_at);
`

function rowToMeta(row: PostgresUserConnectionRow): UserConnectionMeta {
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

export class PostgresConnectionStore implements ConnectionStore {
  private sql: ReturnType<typeof postgres>
  private initialized = false

  constructor(connectionString?: string) {
    const url =
      connectionString ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL

    if (!url) {
      throw new ConnectionStoreError(
        'DATABASE_URL is required for Postgres connection store',
        'STORAGE_ERROR'
      )
    }

    this.sql = postgres(url, { max: 5 })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.sql.unsafe(MIGRATION_SQL)
    this.initialized = true
  }

  async list(userId: string): Promise<UserConnectionMeta[]> {
    await this.ensureInitialized()
    const rows = await this.sql<PostgresUserConnectionRow[]>`
      SELECT id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at
      FROM user_connections WHERE user_id = ${userId} ORDER BY created_at ASC
    `
    return rows.map(rowToMeta)
  }

  async get(
    userId: string,
    connectionId: string
  ): Promise<StoredUserConnection | null> {
    await this.ensureInitialized()
    const rows = await this.sql<PostgresUserConnectionRow[]>`
      SELECT id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at
      FROM user_connections WHERE user_id = ${userId} AND id = ${connectionId} LIMIT 1
    `
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
    const existing = await this.list(userId)
    const now = Date.now()
    const id = crypto.randomUUID()
    const hostId = allocateDbHostId(existing.map((c) => c.hostId))
    const engine = input.engine ?? DEFAULT_SOURCE_ENGINE
    const encryptedPayload = await encryptCredentials(input.credentials)

    if (limit && limit.limit != null && limit.memberUserIds.length > 0) {
      // Same TOCTOU concern as the D1 store, but a bare `INSERT ... SELECT
      // ... WHERE (subquery count)` is NOT enough here: under Postgres's
      // default READ COMMITTED isolation, two concurrent transactions each
      // take their own snapshot for the subquery and neither sees the
      // other's uncommitted insert, so both can pass the check (D1 has no
      // such gap — Cloudflare serializes all statements against a single
      // SQLite connection). Take a transaction-scoped advisory lock keyed on
      // the billing owner FIRST so concurrent creates for the SAME owner
      // queue up instead of racing; creates for different owners are
      // unaffected (different lock key, no contention). The lock is released
      // automatically when the transaction commits/rolls back.
      const ownerLockKey = limit.memberUserIds.slice().sort().join(',')
      const rows = await this.sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${ownerLockKey}))`
        return tx<{ id: string }[]>`
          INSERT INTO user_connections
            (id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at)
          SELECT ${id}, ${userId}, ${input.name}, ${input.hostUrl}, ${input.chUser}, ${hostId}, ${engine}, ${encryptedPayload}, ${now}, ${now}
          WHERE (
            SELECT COUNT(*) FROM user_connections WHERE user_id IN ${tx(limit.memberUserIds)}
          ) < ${limit.limit}
          RETURNING id
        `
      })
      if (rows.length === 0) {
        throw new ConnectionStoreError('Host limit reached', 'LIMIT_EXCEEDED')
      }
    } else {
      await this.sql`
        INSERT INTO user_connections
          (id, user_id, name, host_url, ch_user, host_id, engine, encrypted_payload, created_at, updated_at)
        VALUES
          (${id}, ${userId}, ${input.name}, ${input.hostUrl}, ${input.chUser}, ${hostId}, ${engine}, ${encryptedPayload}, ${now}, ${now})
      `
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

    await this.sql`
      UPDATE user_connections
      SET name = ${name}, host_url = ${hostUrl}, ch_user = ${chUser},
          encrypted_payload = ${encryptedPayload}, updated_at = ${now}
      WHERE user_id = ${userId} AND id = ${connectionId}
    `

    return { ...existing, name, hostUrl, chUser, updatedAt: now }
  }

  async delete(userId: string, connectionId: string): Promise<void> {
    await this.ensureInitialized()
    const rows = await this.sql`
      DELETE FROM user_connections WHERE user_id = ${userId} AND id = ${connectionId}
      RETURNING id
    `
    if (rows.length === 0) {
      throw new ConnectionStoreError('Connection not found', 'NOT_FOUND')
    }
  }

  async getCredentials(userId: string, connectionId: string) {
    const stored = await this.get(userId, connectionId)
    if (!stored) return null
    return decryptCredentials(stored.encryptedPayload)
  }
}

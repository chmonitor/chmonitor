import type {
  ConnectionStore,
  CreateUserConnectionInput,
  StoredUserConnection,
  UpdateUserConnectionInput,
  UserConnectionMeta,
} from '../types'

import { decryptCredentials, encryptCredentials } from '../crypto'
import {
  allocateDbHostId,
  ConnectionStoreError,
  DB_CONNECTION_HOST_ID_START,
} from '../types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

/**
 * In-memory store mirroring D1/Postgres user_id scoping for isolation tests.
 */
class InMemoryConnectionStore implements ConnectionStore {
  private rows = new Map<string, StoredUserConnection>()

  private key(userId: string, connectionId: string): string {
    return `${userId}:${connectionId}`
  }

  async list(userId: string): Promise<UserConnectionMeta[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .map(({ encryptedPayload: _p, ...meta }) => meta)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async get(
    userId: string,
    connectionId: string
  ): Promise<StoredUserConnection | null> {
    return this.rows.get(this.key(userId, connectionId)) ?? null
  }

  async create(
    userId: string,
    input: CreateUserConnectionInput
  ): Promise<UserConnectionMeta> {
    const existing = await this.list(userId)
    const now = Date.now()
    const id = crypto.randomUUID()
    const hostId = allocateDbHostId(existing.map((c) => c.hostId))
    const encryptedPayload = await encryptCredentials(input.credentials)
    const row: StoredUserConnection = {
      id,
      userId,
      name: input.name,
      hostUrl: input.hostUrl,
      chUser: input.chUser,
      hostId,
      engine: input.engine ?? 'clickhouse',
      createdAt: now,
      updatedAt: now,
      encryptedPayload,
    }
    this.rows.set(this.key(userId, id), row)
    return row
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
    const updated: StoredUserConnection = {
      ...existing,
      name: input.name ?? existing.name,
      hostUrl: input.hostUrl ?? existing.hostUrl,
      chUser: input.chUser ?? existing.chUser,
      updatedAt: now,
      encryptedPayload: input.credentials
        ? await encryptCredentials(input.credentials)
        : existing.encryptedPayload,
    }
    this.rows.set(this.key(userId, connectionId), updated)
    return updated
  }

  async delete(userId: string, connectionId: string): Promise<void> {
    const deleted = this.rows.delete(this.key(userId, connectionId))
    if (!deleted) {
      throw new ConnectionStoreError('Connection not found', 'NOT_FOUND')
    }
  }

  async getCredentials(userId: string, connectionId: string) {
    const stored = await this.get(userId, connectionId)
    if (!stored) return null
    return decryptCredentials(stored.encryptedPayload)
  }
}

describe('connection store user isolation', () => {
  const originalKey = process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
  let store: InMemoryConnectionStore

  beforeEach(() => {
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    store = new InMemoryConnectionStore()
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
    } else {
      process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = originalKey
    }
  })

  it('lists only the requesting user connections', async () => {
    await store.create('user_a', {
      name: 'A host',
      hostUrl: 'https://a.example.com',
      chUser: 'default',
      credentials: {
        host: 'https://a.example.com',
        user: 'default',
        password: 'a',
      },
    })
    await store.create('user_b', {
      name: 'B host',
      hostUrl: 'https://b.example.com',
      chUser: 'default',
      credentials: {
        host: 'https://b.example.com',
        user: 'default',
        password: 'b',
      },
    })

    const listA = await store.list('user_a')
    const listB = await store.list('user_b')

    expect(listA).toHaveLength(1)
    expect(listA[0]?.name).toBe('A host')
    expect(listB).toHaveLength(1)
    expect(listB[0]?.name).toBe('B host')
  })

  it('does not return another user credentials by connection id', async () => {
    const created = await store.create('user_a', {
      name: 'Secret',
      hostUrl: 'https://a.example.com',
      chUser: 'default',
      credentials: {
        host: 'https://a.example.com',
        user: 'default',
        password: 'user-a-secret',
      },
    })

    const leaked = await store.getCredentials('user_b', created.id)
    expect(leaked).toBeNull()

    const own = await store.getCredentials('user_a', created.id)
    expect(own?.password).toBe('user-a-secret')
  })

  it('returns NOT_FOUND when another user updates or deletes', async () => {
    const created = await store.create('user_a', {
      name: 'Owned',
      hostUrl: 'https://a.example.com',
      chUser: 'default',
      credentials: {
        host: 'https://a.example.com',
        user: 'default',
        password: 'x',
      },
    })

    await expect(
      store.update('user_b', created.id, { name: 'Hijacked' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(store.delete('user_b', created.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    const stillThere = await store.get('user_a', created.id)
    expect(stillThere?.name).toBe('Owned')
  })

  it('allocates host ids per user independently', async () => {
    const a = await store.create('user_a', {
      name: 'A1',
      hostUrl: 'https://a1.example.com',
      chUser: 'default',
      credentials: {
        host: 'https://a1.example.com',
        user: 'default',
        password: '1',
      },
    })
    const b = await store.create('user_b', {
      name: 'B1',
      hostUrl: 'https://b1.example.com',
      chUser: 'default',
      credentials: {
        host: 'https://b1.example.com',
        user: 'default',
        password: '2',
      },
    })

    expect(a.hostId).toBe(DB_CONNECTION_HOST_ID_START)
    expect(b.hostId).toBe(DB_CONNECTION_HOST_ID_START)
  })
})

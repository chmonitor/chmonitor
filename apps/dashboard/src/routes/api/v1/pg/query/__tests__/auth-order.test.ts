/**
 * A stored-connection request must resolve the caller before the storage
 * feature check, so an anonymous caller gets 401 and never a 501 that
 * reveals how storage is configured (#4016).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { ConnectionStoreError } from '@/lib/connection-store/types'

let dbStorageEnabled = true
mock.module('@/lib/connection-store/server-feature', () => ({
  getUserConnectionsServerConfig: () => ({
    dbStorageEnabled,
    requiresAuth: true,
    encryptionConfigured: true,
  }),
}))

let resolveConnectionUserId = mock(async () => 'user_1')
mock.module('@/lib/connection-store/auth', () => ({
  resolveConnectionUserId: () => resolveConnectionUserId(),
}))

const getCredentials = mock(async () => null)
mock.module('@/lib/connection-store/resolve-store', () => ({
  resolveConnectionStore: async () => ({ getCredentials }),
}))

mock.module('@/lib/feature-flags', () => ({
  featureFlags: { postgresSource: () => true },
}))

mock.module('@/lib/pg-query-config', () => ({
  getPgQueryConfigByName: () => ({ name: 'x', sql: 'SELECT 1' }),
}))

const { __handlePostForTests: handlePost } = await import('../$name')

const req = () =>
  new Request('https://dash.example.com/api/v1/pg/query/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId: 'conn_1' }),
  })

beforeEach(() => {
  dbStorageEnabled = true
  resolveConnectionUserId = mock(async () => 'user_1')
  getCredentials.mockClear()
})

describe('pg/query stored connection: auth before feature check (#4016)', () => {
  test('anonymous caller gets 401 even when db storage is not enabled', async () => {
    dbStorageEnabled = false
    resolveConnectionUserId = mock(async () => {
      throw new ConnectionStoreError(
        'Authentication is required for user connections.',
        'UNAUTHORIZED'
      )
    })

    const res = await handlePost(req(), 'x')

    expect(res.status).toBe(401)
    expect(getCredentials).not.toHaveBeenCalled()
  })

  test('signed-in caller still gets 501 when db storage is not enabled', async () => {
    dbStorageEnabled = false

    const res = await handlePost(req(), 'x')

    expect(res.status).toBe(501)
    expect(resolveConnectionUserId).toHaveBeenCalled()
    expect(getCredentials).not.toHaveBeenCalled()
  })
})

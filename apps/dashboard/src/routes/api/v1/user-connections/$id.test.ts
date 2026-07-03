/**
 * Tests for PATCH/DELETE /api/v1/user-connections/$id — focused on the audit
 * wiring added for plans/22-audit-log-export.md (connection.updated /
 * connection.deleted). `logSessionEvent` itself (org resolution + no-op
 * behavior) is already fully covered by lib/audit/log-session-event.test.ts,
 * so this file only proves each route calls it with the right event shape —
 * mocked at its LEAF specifier (`@/lib/audit/log-session-event`), never the
 * `@/lib/audit` barrel.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let logSessionEventImpl = mock((_e: unknown) => Promise.resolve())
mock.module('@/lib/audit/log-session-event', () => ({
  logSessionEvent: (e: unknown) => logSessionEventImpl(e),
}))

mock.module('@/lib/connection-store/server-feature', () => ({
  getUserConnectionsServerConfig: () => ({
    dbStorageEnabled: true,
    requiresAuth: true,
    encryptionConfigured: true,
  }),
}))

mock.module('@/lib/browser-connections/host-url', () => ({
  validateHostUrl: async (_host: string) => null,
  createHostValidationFetch: () => fetch,
}))

let resolveConnectionUserId = mock(async () => 'user_1')
mock.module('@/lib/connection-store/auth', () => ({
  GUEST_USER_ID: 'guest',
  resolveConnectionUserId: () => resolveConnectionUserId(),
}))

let storeUpdate = mock(
  async (_userId: string, _connectionId: string, input: { name?: string }) => ({
    id: 'conn_1',
    hostId: -1000,
    name: input.name ?? 'my-conn',
    hostUrl: 'https://ch.example.com',
    chUser: 'default',
    updatedAt: 2,
  })
)
let storeDelete = mock(async (_userId: string, _connectionId: string) => {})
mock.module('@/lib/connection-store/resolve-store', () => ({
  resolveConnectionStore: async () => ({
    list: async () => [],
    get: async () => null,
    create: async () => {
      throw new Error('not used in this test file')
    },
    update: (userId: string, connectionId: string, input: { name?: string }) =>
      storeUpdate(userId, connectionId, input),
    delete: (userId: string, connectionId: string) =>
      storeDelete(userId, connectionId),
    getCredentials: async () => null,
  }),
}))

const {
  __handlePatchForTests: handlePatch,
  __handleDeleteForTests: handleDelete,
} = await import('./$id')

beforeEach(() => {
  logSessionEventImpl = mock(() => Promise.resolve())
  resolveConnectionUserId = mock(async () => 'user_1')
  storeUpdate = mock(
    async (_u: string, _c: string, input: { name?: string }) => ({
      id: 'conn_1',
      hostId: -1000,
      name: input.name ?? 'my-conn',
      hostUrl: 'https://ch.example.com',
      chUser: 'default',
      updatedAt: 2,
    })
  )
  storeDelete = mock(async () => {})
})

describe('PATCH /api/v1/user-connections/$id — audit wiring', () => {
  test('a successful update logs connection.updated:success', async () => {
    const request = new Request(
      'https://dash.example.com/api/v1/user-connections/conn_1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed' }),
      }
    )

    const res = await handlePatch(request, 'conn_1')

    expect(res.status).toBe(200)
    expect(logSessionEventImpl).toHaveBeenCalledTimes(1)
    expect(logSessionEventImpl.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user_1',
      event: 'connection.updated',
      resource: 'conn_1',
      action: 'update',
      result: 'success',
    })
  })
})

describe('DELETE /api/v1/user-connections/$id — audit wiring', () => {
  test('a successful delete logs connection.deleted:success', async () => {
    const res = await handleDelete('conn_1')

    expect(res.status).toBe(200)
    expect(logSessionEventImpl).toHaveBeenCalledTimes(1)
    expect(logSessionEventImpl.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user_1',
      event: 'connection.deleted',
      resource: 'conn_1',
      action: 'delete',
      result: 'success',
    })
  })

  test('a store failure never reaches logSessionEvent', async () => {
    storeDelete = mock(async () => {
      throw new Error('boom')
    })

    const res = await handleDelete('conn_1')

    expect(res.status).toBe(500)
    expect(logSessionEventImpl).not.toHaveBeenCalled()
  })
})

/**
 * /api/v1/agents/anyrouter/token — flag gate, auth, and the "never return the
 * token" contract. The store and Clerk auth are mocked; the store's own
 * encryption/isolation is covered by `lib/ai/agent/__tests__/user-token-store.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { ConversationStoreError } from '@/lib/conversation-store/types'

let signedInUser: string | null = 'user_a'
mock.module('@/lib/conversation-store/auth', () => ({
  GUEST_USER_ID: 'guest',
  resolveUserId: async () => {
    if (!signedInUser) {
      throw new ConversationStoreError(
        'Authentication is required.',
        'UNAUTHORIZED'
      )
    }
    return signedInUser
  },
}))

class FakeStoreError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
let storeDown = false
const saved = new Map<string, { token: string; expiresAt: number | null }>()
const saveUserProviderToken = mock(
  async (
    owner: string,
    _p: string,
    token: string,
    expiresAt: number | null
  ) => {
    if (storeDown) throw new FakeStoreError('UNAVAILABLE')
    saved.set(owner, { token, expiresAt })
  }
)
mock.module('@/lib/ai/agent/user-token-store', () => ({
  UserTokenStoreError: FakeStoreError,
  saveUserProviderToken,
  getUserProviderTokenStatus: async (owner: string) => {
    if (storeDown) throw new FakeStoreError('UNAVAILABLE')
    const row = saved.get(owner)
    return row
      ? { connected: true, expiresAt: row.expiresAt }
      : { connected: false, expiresAt: null }
  },
  deleteUserProviderToken: async (owner: string) => {
    saved.delete(owner)
  },
}))

const {
  __handleGetForTests: handleGet,
  __handlePutForTests: handlePut,
  __handleDeleteForTests: handleDelete,
} = await import('../token')

const FLAG = 'CHM_AGENT_ANYROUTER_SIGNIN_ENABLED'
const savedFlag = process.env[FLAG]
const TOKEN = 'ar-user-token-abcdef123456'

function put(body: unknown): Request {
  return new Request(
    'https://dash.chmonitor.dev/api/v1/agents/anyrouter/token',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

beforeEach(() => {
  process.env[FLAG] = 'true'
  signedInUser = 'user_a'
  storeDown = false
  saved.clear()
  saveUserProviderToken.mockClear()
})

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = savedFlag
})

describe('/api/v1/agents/anyrouter/token', () => {
  test('flag off → 404 on every method, nothing stored', async () => {
    delete process.env[FLAG]
    expect((await handleGet()).status).toBe(404)
    expect((await handlePut(put({ token: TOKEN }))).status).toBe(404)
    expect((await handleDelete()).status).toBe(404)
    expect(saveUserProviderToken).not.toHaveBeenCalled()
  })

  test('anonymous caller → 401 (guests keep the token in the browser only)', async () => {
    signedInUser = null
    expect((await handleGet()).status).toBe(401)
    expect((await handlePut(put({ token: TOKEN }))).status).toBe(401)
    expect((await handleDelete()).status).toBe(401)
    expect(saveUserProviderToken).not.toHaveBeenCalled()
  })

  test('PUT saves for the signed-in user; GET reports status without the token', async () => {
    const expiresAt = Date.now() + 86_400_000
    const putRes = await handlePut(put({ token: TOKEN, expiresAt }))
    expect(putRes.status).toBe(200)
    expect(await putRes.json()).toEqual({ connected: true, expiresAt })
    expect(saved.get('user_a')).toEqual({ token: TOKEN, expiresAt })

    const getRes = await handleGet()
    const text = await getRes.text()
    expect(getRes.status).toBe(200)
    expect(text).not.toContain(TOKEN)
    expect(JSON.parse(text)).toEqual({ connected: true, expiresAt })
    expect(getRes.headers.get('Cache-Control')).toBe('no-store')
  })

  test('PUT rejects a missing/invalid token or a past expiry', async () => {
    expect((await handlePut(put({}))).status).toBe(400)
    expect((await handlePut(put({ token: 'short' }))).status).toBe(400)
    expect(
      (await handlePut(put({ token: TOKEN, expiresAt: 'soon' }))).status
    ).toBe(400)
    expect(
      (await handlePut(put({ token: TOKEN, expiresAt: Date.now() - 1 }))).status
    ).toBe(400)
    expect(saveUserProviderToken).not.toHaveBeenCalled()
  })

  test('DELETE revokes the stored token', async () => {
    await handlePut(put({ token: TOKEN }))
    const res = await handleDelete()
    expect(await res.json()).toEqual({ connected: false, expiresAt: null })
    expect(saved.has('user_a')).toBe(false)
  })

  test('store unavailable → 503, token not echoed', async () => {
    storeDown = true
    const res = await handlePut(put({ token: TOKEN }))
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain(TOKEN)
  })
})

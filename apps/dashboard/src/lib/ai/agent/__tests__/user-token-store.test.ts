/**
 * user-token-store: a signed-in user's AnyRouter token is stored encrypted,
 * readable only by the same owner, never stored without a key, and an expired
 * row reads as "not connected".
 *
 * `@chm/platform` is mocked with a tiny in-memory D1 that understands exactly
 * the four statements the store issues, so the rows the test inspects are what
 * would land in the real table.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

type Row = {
  owner_id: string
  provider: string
  ciphertext: string
  iv: string
  expires_at: number | null
  updated_at: number
}

const rows = new Map<string, Row>()
let dbBound = true

function fakeD1() {
  return {
    prepare(sql: string) {
      let args: unknown[] = []
      const stmt = {
        bind(...values: unknown[]) {
          args = values
          return stmt
        },
        async run() {
          const [owner, provider] = args as [string, string]
          if (sql.startsWith('INSERT')) {
            const [, , ciphertext, iv, expiresAt, updatedAt] = args
            rows.set(`${owner}|${provider}`, {
              owner_id: owner,
              provider,
              ciphertext: ciphertext as string,
              iv: iv as string,
              expires_at: expiresAt as number | null,
              updated_at: updatedAt as number,
            })
          } else if (sql.startsWith('DELETE')) {
            rows.delete(`${owner}|${provider}`)
          }
          return { success: true }
        },
        async first<T>() {
          const [owner, provider] = args as [string, string]
          return (rows.get(`${owner}|${provider}`) ?? null) as T | null
        },
      }
      return stmt
    },
  }
}

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => (dbBound ? fakeD1() : null),
  }),
}))

const store = await import('../user-token-store')
const {
  deleteUserProviderToken,
  getUserProviderToken,
  getUserProviderTokenStatus,
  saveUserProviderToken,
  UserTokenStoreError,
} = store

const KEY_ENVS = ['CHM_USER_CONNECTIONS_ENCRYPTION_KEY', 'CLERK_SECRET_KEY']
const savedEnv = Object.fromEntries(KEY_ENVS.map((k) => [k, process.env[k]]))
const TOKEN = 'ar-user-token-abcdef123456'
const NOW = 1_800_000_000_000

beforeEach(() => {
  rows.clear()
  dbBound = true
  delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
  process.env.CLERK_SECRET_KEY = 'sk_test_token_store'
})

afterEach(() => {
  for (const k of KEY_ENVS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('user-token-store', () => {
  test('round-trip: save then read returns the token; the row holds no plaintext', async () => {
    await saveUserProviderToken('user_a', 'anyrouter', TOKEN, NOW + 60_000, NOW)

    const row = rows.get('user_a|anyrouter')
    expect(row).toBeDefined()
    expect(row!.ciphertext).not.toContain(TOKEN)
    expect(atob(row!.ciphertext)).not.toContain(TOKEN)

    expect(await getUserProviderToken('user_a', 'anyrouter', NOW)).toEqual({
      token: TOKEN,
      expiresAt: NOW + 60_000,
    })
    expect(
      await getUserProviderTokenStatus('user_a', 'anyrouter', NOW)
    ).toEqual({ connected: true, expiresAt: NOW + 60_000 })
  })

  test('save again replaces the previous token (one row per owner+provider)', async () => {
    await saveUserProviderToken('user_a', 'anyrouter', TOKEN, null, NOW)
    await saveUserProviderToken('user_a', 'anyrouter', `${TOKEN}-2`, null, NOW)
    expect(rows.size).toBe(1)
    expect(
      (await getUserProviderToken('user_a', 'anyrouter', NOW))?.token
    ).toBe(`${TOKEN}-2`)
  })

  test('per-owner isolation: another owner sees nothing, and a copied row does not decrypt', async () => {
    await saveUserProviderToken('user_a', 'anyrouter', TOKEN, null, NOW)

    expect(await getUserProviderToken('user_b', 'anyrouter', NOW)).toBeNull()
    expect(
      (await getUserProviderTokenStatus('user_b', 'anyrouter', NOW)).connected
    ).toBe(false)

    // Owner id is bound into the GCM additional data: moving A's ciphertext
    // under B must fail, not hand B the token.
    rows.set('user_b|anyrouter', {
      ...rows.get('user_a|anyrouter')!,
      owner_id: 'user_b',
    })
    const err = await getUserProviderToken('user_b', 'anyrouter', NOW).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(UserTokenStoreError)
    expect(err.code).toBe('DECRYPT_FAILED')
  })

  test('expired token reads as not connected', async () => {
    await saveUserProviderToken('user_a', 'anyrouter', TOKEN, NOW - 1, NOW - 10)
    expect(await getUserProviderToken('user_a', 'anyrouter', NOW)).toBeNull()
    expect(
      await getUserProviderTokenStatus('user_a', 'anyrouter', NOW)
    ).toEqual({ connected: false, expiresAt: null })
  })

  test('delete removes the token and is idempotent', async () => {
    await saveUserProviderToken('user_a', 'anyrouter', TOKEN, null, NOW)
    await deleteUserProviderToken('user_a', 'anyrouter')
    await deleteUserProviderToken('user_a', 'anyrouter')
    expect(await getUserProviderToken('user_a', 'anyrouter', NOW)).toBeNull()
  })

  test('fail closed: no encryption key → UNAVAILABLE and nothing is written', async () => {
    delete process.env.CLERK_SECRET_KEY
    const err = await saveUserProviderToken(
      'user_a',
      'anyrouter',
      TOKEN,
      null,
      NOW
    ).catch((e) => e)
    expect(err).toBeInstanceOf(UserTokenStoreError)
    expect(err.code).toBe('UNAVAILABLE')
    expect(rows.size).toBe(0)
  })

  test('fail closed: no D1 binding → UNAVAILABLE', async () => {
    dbBound = false
    const err = await getUserProviderTokenStatus('user_a', 'anyrouter').catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(UserTokenStoreError)
    expect(err.code).toBe('UNAVAILABLE')
  })
})

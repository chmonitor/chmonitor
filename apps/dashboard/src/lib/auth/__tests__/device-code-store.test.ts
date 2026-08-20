import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// device-code-store → @chm/platform → cloudflare:workers (Node/bun has no
// workerd builtins). Stub both so memory fallback can be unit-tested.
mock.module('cloudflare:workers', () => ({ env: {} }))
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => null,
  }),
}))

const {
  __resetDeviceCodeMemoryForTests,
  approveUserCode,
  getByDeviceCode,
  insertDeviceCode,
  markConsumed,
} = await import('../device-code-store')

describe('device-code-store memory fallback', () => {
  beforeEach(() => {
    __resetDeviceCodeMemoryForTests()
  })

  afterEach(() => {
    __resetDeviceCodeMemoryForTests()
  })

  it('inserts, approves, and consumes a code in memory', async () => {
    const now = Date.now()
    const ok = await insertDeviceCode({
      deviceCode: 'dev-1',
      userCode: 'abcd-efgh',
      clientId: 'chm-cli',
      createdAt: now,
      expiresAt: now + 60_000,
    })
    expect(ok).toBe(true)

    const pending = await getByDeviceCode('dev-1')
    expect(pending?.userCode).toBe('ABCD-EFGH')
    expect(pending?.approvedAt).toBeNull()

    const approved = await approveUserCode('abcd-efgh', 'self-hosted')
    expect(approved).toEqual({ ok: true })

    const after = await getByDeviceCode('dev-1')
    expect(after?.userId).toBe('self-hosted')
    expect(after?.approvedAt).not.toBeNull()

    expect(await markConsumed('dev-1')).toBe(true)
    const consumed = await getByDeviceCode('dev-1')
    expect(consumed?.consumedAt).not.toBeNull()
  })

  it('rejects approve of unknown / expired codes', async () => {
    expect(await approveUserCode('NOPE-CODE', 'u')).toEqual({
      ok: false,
      error: 'not_found',
    })

    const now = Date.now()
    await insertDeviceCode({
      deviceCode: 'dev-exp',
      userCode: 'EXPI-RED1',
      clientId: 'chm-cli',
      createdAt: now - 10_000,
      expiresAt: now - 1,
    })
    expect(await approveUserCode('EXPI-RED1', 'u')).toEqual({
      ok: false,
      error: 'expired',
    })
  })
})

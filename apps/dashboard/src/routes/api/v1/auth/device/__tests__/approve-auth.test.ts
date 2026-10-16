/**
 * Approving a device mints a `chm_` key for the approver, so whenever an auth
 * provider is configured the approver must be a signed-in user; anonymous
 * callers (including under Clerk public read) get 401. Only `none` is the
 * explicit device-only mode and still approves without sign-in.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __resetDeviceCodeMemoryForTests,
  insertDeviceCode,
} from '@/lib/auth/device-code-store'

const { __handlePostForTests: approve } = await import('../approve')

const KEYS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_CLERK_PUBLIC_READ',
  'CHM_API_KEY_SECRET',
  'CHM_DEVICE_LOGIN',
  'CHM_CLOUD_MODE',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  __resetDeviceCodeMemoryForTests()
  process.env.CHM_DEVICE_LOGIN = 'true'
  process.env.CHM_API_KEY_SECRET = 'test-device-login-secret-at-least-32-chars'
  process.env.CHM_CLOUD_MODE = 'false'
})
afterEach(() => {
  __resetDeviceCodeMemoryForTests()
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function pendingCode(): Promise<string> {
  const userCode = 'ABCD-EFGH'
  const now = Date.now()
  await insertDeviceCode({
    deviceCode: 'device-code-1',
    userCode,
    clientId: 'chm-cli',
    createdAt: now,
    expiresAt: now + 600_000,
  })
  return userCode
}

async function post(userCode: string): Promise<Response> {
  return approve(
    new Request('https://dash.example.com/api/v1/auth/device/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_code: userCode }),
    })
  )
}

describe('device approve auth', () => {
  for (const provider of ['clerk', 'proxy', 'trusted']) {
    test(`${provider}: anonymous caller is rejected and the code stays pending`, async () => {
      process.env.CHM_AUTH_PROVIDER = provider
      process.env.CHM_CLERK_PUBLIC_READ = 'true'
      const userCode = await pendingCode()
      const res = await post(userCode)
      expect(res.status).toBe(401)

      // Same code is still approvable once auth is off: it was not consumed.
      process.env.CHM_AUTH_PROVIDER = 'none'
      expect((await post(userCode)).status).toBe(200)
    })
  }

  test('none: device-only approve still works without sign-in', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    const res = await post(await pendingCode())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { deviceOnly: boolean } }
    expect(body.data.deviceOnly).toBe(true)
  })
})

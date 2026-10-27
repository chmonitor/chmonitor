/**
 * #4227: under CHM_AUTH_PROVIDER=trusted the conversation owner comes from
 * the trusted provider (never raw headers), is namespaced so it cannot
 * collide with a Clerk user id, and an unauthenticated request fails closed.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: 'user_clerk_1' }),
}))

const { resolveConversationUserId } = await import('../auth')
const { ConversationStoreError } = await import('../types')

const KEYS = [
  'CHM_AUTH_PROVIDER',
  'CHM_TRUSTED_ALLOW_INSECURE',
  'CHM_TRUSTED_AUTH_SECRET',
  'CLERK_SECRET_KEY',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/conversations', { headers })
}

async function expectUnauthorized(p: Promise<string>): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(ConversationStoreError)
  expect((err as InstanceType<typeof ConversationStoreError>).code).toBe(
    'UNAUTHORIZED'
  )
}

describe('resolveConversationUserId', () => {
  test('trusted: authenticated subject → namespaced trusted id', async () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    process.env.CHM_TRUSTED_ALLOW_INSECURE = 'true'
    const id = await resolveConversationUserId(
      req({ 'X-Forwarded-User': 'alice' })
    )
    expect(id).toBe('trusted:alice')
  })

  test('trusted: no identity header → UNAUTHORIZED', async () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    process.env.CHM_TRUSTED_ALLOW_INSECURE = 'true'
    await expectUnauthorized(resolveConversationUserId(req()))
  })

  test('trusted: provider fails closed (no secret, no insecure opt-in) → UNAUTHORIZED', async () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    await expectUnauthorized(
      resolveConversationUserId(req({ 'X-Forwarded-User': 'alice' }))
    )
  })

  test('clerk: keeps the Clerk user id unprefixed', async () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CLERK_SECRET_KEY = 'sk_test_x'
    expect(await resolveConversationUserId(req())).toBe('user_clerk_1')
  })

  test('none: UNAUTHORIZED even with a forged forwarded user', async () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    await expectUnauthorized(
      resolveConversationUserId(req({ 'X-Forwarded-User': 'alice' }))
    )
  })
})

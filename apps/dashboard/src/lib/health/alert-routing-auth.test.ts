import {
  requiresSignInForWrite,
  SINGLE_TENANT_OWNER_ID,
} from './alert-routing-auth'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const ENV_KEYS = ['CHM_AUTH_PROVIDER', 'VITE_AUTH_PROVIDER'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('requiresSignInForWrite', () => {
  test('OSS (no Clerk) allows anonymous single-tenant writes', () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    expect(requiresSignInForWrite(SINGLE_TENANT_OWNER_ID)).toBe(false)
  })

  test('cloud Clerk rejects anonymous single-tenant writes', () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    expect(requiresSignInForWrite(SINGLE_TENANT_OWNER_ID)).toBe(true)
  })

  test('signed-in owner id is never rejected by the gate', () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    expect(requiresSignInForWrite('user_123')).toBe(false)
  })
})

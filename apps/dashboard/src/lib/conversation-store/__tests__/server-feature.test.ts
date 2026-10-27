/**
 * #4227: a self-hosted image built with the flag off must persist agent
 * conversations when the operator sets CHM_FEATURE_CONVERSATION_DB=true at
 * runtime behind a trusted proxy with a Postgres backend — and must never
 * route trusted users to the in-process MemoryStore when no backend exists.
 */

import { getConversationStoreServerConfig } from '../server-feature'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const KEYS = [
  'CHM_FEATURE_CONVERSATION_DB',
  'VITE_FEATURE_CONVERSATION_DB',
  'CHM_DEPLOYMENT_MODE',
  'CHM_AUTH_PROVIDER',
  'CLERK_SECRET_KEY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'AGENTSTATE_API_KEY',
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

describe('getConversationStoreServerConfig', () => {
  test('trusted + DATABASE_URL + runtime flag → enabled with trusted identity', () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    process.env.DATABASE_URL = 'postgres://u:p@db:5432/chm'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'true'
    expect(getConversationStoreServerConfig()).toEqual({
      dbStorageEnabled: true,
      identity: 'trusted',
    })
  })

  test('trusted + AgentState key counts as a durable backend', () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    process.env.AGENTSTATE_API_KEY = 'k'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'true'
    expect(getConversationStoreServerConfig().dbStorageEnabled).toBe(true)
  })

  test('trusted without a durable backend stays off (no MemoryStore)', () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'true'
    expect(getConversationStoreServerConfig()).toEqual({
      dbStorageEnabled: false,
      identity: null,
    })
  })

  test('trusted + backend but flag explicitly off stays off', () => {
    process.env.CHM_AUTH_PROVIDER = 'trusted'
    process.env.DATABASE_URL = 'postgres://u:p@db:5432/chm'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'false'
    expect(getConversationStoreServerConfig().dbStorageEnabled).toBe(false)
  })

  test('clerk + secret key + flag → enabled with clerk identity', () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CLERK_SECRET_KEY = 'sk_test_x'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'true'
    expect(getConversationStoreServerConfig()).toEqual({
      dbStorageEnabled: true,
      identity: 'clerk',
    })
  })

  test('cloud deployment mode defaults the flag on for clerk', () => {
    process.env.CHM_DEPLOYMENT_MODE = 'cloud'
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CLERK_SECRET_KEY = 'sk_test_x'
    expect(getConversationStoreServerConfig().dbStorageEnabled).toBe(true)
  })

  test('clerk without a secret key stays off', () => {
    process.env.CHM_AUTH_PROVIDER = 'clerk'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'true'
    expect(getConversationStoreServerConfig().dbStorageEnabled).toBe(false)
  })

  test('auth provider none stays off even with flag and backend', () => {
    process.env.CHM_AUTH_PROVIDER = 'none'
    process.env.DATABASE_URL = 'postgres://u:p@db:5432/chm'
    process.env.CHM_FEATURE_CONVERSATION_DB = 'true'
    expect(getConversationStoreServerConfig().dbStorageEnabled).toBe(false)
  })
})

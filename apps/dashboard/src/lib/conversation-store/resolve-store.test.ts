/**
 * Tests for {@link resolveStore} and {@link isPersistentStore}.
 *
 * resolveStore() consults several collaborators before reaching a backend:
 *   1. `isConversationDbEnabled()` — runtime flag + identity (server-feature.ts).
 *   2. `process.env.CONVERSATION_STORE_BACKEND` / `AGENTSTATE_API_KEY`.
 *   3. `getPlatformBindings().getD1Database(...)` for the D1 fallback.
 *
 * To isolate branches in a unit test we mock:
 *   - `./server-feature` with a controllable `isConversationDbEnabled` mock (defaults
 *     to true; flipped to false to exercise the disabled-feature branch).
 *   - `@chm/platform` so getD1Database() returns undefined (no D1 binding).
 *   - `@agentstate/sdk` with a minimal fake so `new AgentStateStore(...)` works
 *     without a real network client.
 *
 * Covers: feature-flag-off → BrowserStore, the AgentState branch, the
 * MemoryStore fallback, and the isPersistentStore predicate. Env is
 * snapshot/restored around each test.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Mocks (process-global; registered before importing resolve-store). ──
// conversationDb is a controllable mock so we can exercise both the enabled and
// disabled feature-flag branches; reset to `true` before each test.
const mockConversationDb = mock(() => true)
mock.module('./server-feature', () => ({
  isConversationDbEnabled: mockConversationDb,
}))

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    // No D1 binding available — pushes resolution past the D1 branch.
    getD1Database: () => undefined,
  }),
}))

class FakeAgentStateError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

class FakeAgentState {}

mock.module('@agentstate/sdk', () => ({
  AgentState: FakeAgentState,
  AgentStateError: FakeAgentStateError,
}))

const { resolveStore, isPersistentStore } = await import('./resolve-store')
const { AgentStateStore } = await import('./agentstate-store')
const { BrowserStore } = await import('./browser-store')
const { MemoryStore } = await import('./memory-store')
const { ConversationStoreError } = await import('./types')

// ── Env snapshot/restore so tests don't leak state. ──
const ENV_KEYS = [
  'CONVERSATION_STORE_BACKEND',
  'AGENTSTATE_API_KEY',
  'AGENTSTATE_BASE_URL',
  'AGENTSTATE_AI_ENRICH',
  'DATABASE_URL',
] as const

let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  mockConversationDb.mockReturnValue(true)
  snapshot = {}
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = snapshot[key]
    }
  }
})

describe('resolveStore — feature flag disabled', () => {
  test('returns a BrowserStore when conversationDb() is false', async () => {
    mockConversationDb.mockReturnValue(false)
    // Even with an AgentState key set, the disabled flag wins (checked first).
    process.env.AGENTSTATE_API_KEY = 'as_live_key'
    const store = await resolveStore()
    expect(store).toBeInstanceOf(BrowserStore)
  })
})

describe('resolveStore — AgentState branch', () => {
  test('forcing agentstate without AGENTSTATE_API_KEY throws VALIDATION_ERROR', async () => {
    process.env.CONVERSATION_STORE_BACKEND = 'agentstate'
    // No AGENTSTATE_API_KEY set.
    await expect(resolveStore()).rejects.toBeInstanceOf(ConversationStoreError)
    await expect(resolveStore()).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  test('forcing agentstate with a key returns an AgentStateStore', async () => {
    process.env.CONVERSATION_STORE_BACKEND = 'agentstate'
    process.env.AGENTSTATE_API_KEY = 'as_live_key'
    const store = await resolveStore()
    expect(store).toBeInstanceOf(AgentStateStore)
  })

  test('an API key alone (no forced backend) returns an AgentStateStore', async () => {
    process.env.AGENTSTATE_API_KEY = 'as_live_key'
    const store = await resolveStore()
    expect(store).toBeInstanceOf(AgentStateStore)
  })

  test('a key present but another backend forced does NOT pick AgentState', async () => {
    process.env.AGENTSTATE_API_KEY = 'as_live_key'
    process.env.CONVERSATION_STORE_BACKEND = 'memory'
    const store = await resolveStore()
    expect(store).not.toBeInstanceOf(AgentStateStore)
  })
})

describe('resolveStore — MemoryStore fallback', () => {
  test('no backend config (flag on, no key/D1/DATABASE_URL) falls back to MemoryStore', async () => {
    const store = await resolveStore()
    expect(store).toBeInstanceOf(MemoryStore)
  })

  test('CONVERSATION_STORE_BACKEND=memory forces MemoryStore even with an AgentState key', async () => {
    process.env.CONVERSATION_STORE_BACKEND = 'memory'
    process.env.AGENTSTATE_API_KEY = 'as_live_key'
    const store = await resolveStore()
    expect(store).toBeInstanceOf(MemoryStore)
  })
})

describe('isPersistentStore', () => {
  test('MemoryStore is NOT persistent', () => {
    expect(isPersistentStore(new MemoryStore())).toBe(false)
  })

  test('BrowserStore is persistent', () => {
    expect(isPersistentStore(new BrowserStore())).toBe(true)
  })

  test('AgentStateStore is persistent', () => {
    expect(
      isPersistentStore(new AgentStateStore({ apiKey: 'as_live_key' }))
    ).toBe(true)
  })
})

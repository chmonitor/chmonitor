/**
 * Tests for feature-flags.ts
 *
 * Each flag function reads:
 *   1. import.meta.env.VITE_FEATURE_* at call time (short-circuit gate).
 *   2. isClerkEnabled() from @/lib/clerk/clerk-client.
 *
 * Under bun:test, process.env is mirrored into import.meta.env, which is also
 * mutable directly. The VITE_FEATURE_* vars are read at call time (not at
 * module load), so setting them before calling the flag function is sufficient.
 *
 * isClerkEnabled() in clerk-client.ts captures CLERK_PUBLISHABLE_KEY as a
 * module-level const at import time — it cannot be varied by mutating env after
 * the module is cached. We therefore mock @/lib/clerk/clerk-client via
 * mock.module() so isClerkEnabled is fully controllable, matching the pattern
 * used in resolve-store.test.ts for featureFlags itself.
 *
 * Structure:
 *   - describe 'flag gate (VITE_FEATURE_*)': exercises the short-circuit path
 *     with Clerk mocked to return true, so the env var alone decides the result.
 *   - describe 'Clerk gate': exercises the second condition (flag="true", vary
 *     isClerkEnabled return value via mock).
 *   - describe 'isFeatureEnabled': verifies the public wrapper delegates correctly.
 *   - describe 'shape': structural invariants on the featureFlags object.
 */

import type { FeatureFlagName } from './feature-flags'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Mock @/lib/clerk/clerk-client ────────────────────────────────────────────
// Registered before any import of the module under test so the mock is in place
// when feature-flags.ts first evaluates its import.
const mockIsClerkEnabled = mock(() => true)

mock.module('@/lib/clerk/clerk-client', () => ({
  isClerkEnabled: mockIsClerkEnabled,
  isClerkClientEnabled: mockIsClerkEnabled,
  CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
}))

// ── Import module under test (after mock registration) ───────────────────────
const { featureFlags, isFeatureEnabled } = await import('./feature-flags')

// ── Env keys we touch ────────────────────────────────────────────────────────
const FEATURE_KEYS = [
  'VITE_FEATURE_CONVERSATION_DB',
  'VITE_FEATURE_USER_CONNECTIONS_DB',
  'VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS',
  'VITE_FEATURE_POSTGRES_SOURCE',
] as const

type FeatureEnvKey = (typeof FEATURE_KEYS)[number]

// ── Snapshot / restore helpers ────────────────────────────────────────────────
let snapshot: Partial<Record<FeatureEnvKey, string | undefined>> = {}

function setEnv(key: FeatureEnvKey, value: string): void {
  process.env[key] = value
  ;(import.meta.env as Record<string, unknown>)[key] = value
}

function unsetEnv(key: FeatureEnvKey): void {
  delete process.env[key]
  delete (import.meta.env as Record<string, unknown>)[key]
}

beforeEach(() => {
  // Default Clerk to enabled so the Clerk gate is not the variable in env tests.
  mockIsClerkEnabled.mockReturnValue(true)
  snapshot = {}
  for (const key of FEATURE_KEYS) {
    snapshot[key] = process.env[key]
    unsetEnv(key)
  }
})

afterEach(() => {
  for (const key of FEATURE_KEYS) {
    const saved = snapshot[key]
    if (saved === undefined) {
      unsetEnv(key)
    } else {
      setEnv(key, saved)
    }
  }
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('featureFlags.conversationDb — VITE_FEATURE_CONVERSATION_DB gate', () => {
  // Clerk mock returns true throughout these tests; only the env var varies.

  test('returns false when env var is unset (safe default)', () => {
    expect(featureFlags.conversationDb()).toBe(false)
  })

  test('returns false when env var is "false"', () => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'false')
    expect(featureFlags.conversationDb()).toBe(false)
  })

  test('returns false when env var is "1" (not strictly "true")', () => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', '1')
    expect(featureFlags.conversationDb()).toBe(false)
  })

  test('returns false when env var is "True" (case-sensitive check)', () => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'True')
    expect(featureFlags.conversationDb()).toBe(false)
  })

  test('returns true when env var is exactly "true" and Clerk is enabled', () => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'true')
    expect(featureFlags.conversationDb()).toBe(true)
  })
})

describe('featureFlags.conversationDb — Clerk gate (env var = "true")', () => {
  // Env var is always "true" here; only isClerkEnabled() varies.

  beforeEach(() => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'true')
  })

  test('returns false when Clerk is NOT enabled', () => {
    mockIsClerkEnabled.mockReturnValue(false)
    expect(featureFlags.conversationDb()).toBe(false)
  })

  test('returns true when Clerk IS enabled', () => {
    mockIsClerkEnabled.mockReturnValue(true)
    expect(featureFlags.conversationDb()).toBe(true)
  })
})

describe('featureFlags.userConnectionsDb — VITE_FEATURE_USER_CONNECTIONS_DB gate', () => {
  // Clerk mock returns true throughout; only the env var varies.

  test('returns false when env var is unset (safe default)', () => {
    expect(featureFlags.userConnectionsDb()).toBe(false)
  })

  test('returns false when env var is "false"', () => {
    setEnv('VITE_FEATURE_USER_CONNECTIONS_DB', 'false')
    expect(featureFlags.userConnectionsDb()).toBe(false)
  })

  test('returns false when env var is "1" (not strictly "true")', () => {
    setEnv('VITE_FEATURE_USER_CONNECTIONS_DB', '1')
    expect(featureFlags.userConnectionsDb()).toBe(false)
  })

  test('returns true when env var is exactly "true" and Clerk is enabled', () => {
    setEnv('VITE_FEATURE_USER_CONNECTIONS_DB', 'true')
    expect(featureFlags.userConnectionsDb()).toBe(true)
  })
})

describe('featureFlags.userConnectionsDb — Clerk gate (env var = "true")', () => {
  beforeEach(() => {
    setEnv('VITE_FEATURE_USER_CONNECTIONS_DB', 'true')
  })

  test('returns false when Clerk is NOT enabled', () => {
    mockIsClerkEnabled.mockReturnValue(false)
    expect(featureFlags.userConnectionsDb()).toBe(false)
  })

  test('returns true when Clerk IS enabled', () => {
    mockIsClerkEnabled.mockReturnValue(true)
    expect(featureFlags.userConnectionsDb()).toBe(true)
  })
})

describe('featureFlags.webhookSubscriptions — VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS gate', () => {
  // Clerk mock returns true throughout; only the env var varies.

  test('returns false when env var is unset (safe default)', () => {
    expect(featureFlags.webhookSubscriptions()).toBe(false)
  })

  test('returns false when env var is "false"', () => {
    setEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS', 'false')
    expect(featureFlags.webhookSubscriptions()).toBe(false)
  })

  test('returns false when env var is "1" (not strictly "true")', () => {
    setEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS', '1')
    expect(featureFlags.webhookSubscriptions()).toBe(false)
  })

  test('returns true when env var is exactly "true" and Clerk is enabled', () => {
    setEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS', 'true')
    expect(featureFlags.webhookSubscriptions()).toBe(true)
  })
})

describe('featureFlags.webhookSubscriptions — Clerk gate (env var = "true")', () => {
  beforeEach(() => {
    setEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS', 'true')
  })

  test('returns false when Clerk is NOT enabled', () => {
    mockIsClerkEnabled.mockReturnValue(false)
    expect(featureFlags.webhookSubscriptions()).toBe(false)
  })

  test('returns true when Clerk IS enabled', () => {
    mockIsClerkEnabled.mockReturnValue(true)
    expect(featureFlags.webhookSubscriptions()).toBe(true)
  })
})

describe('featureFlags.postgresSource — pure env gate (NOT Clerk-gated)', () => {
  // Unlike the other flags, postgresSource must give OSS/self-hosted equal
  // support, so it never requires Clerk — the env var alone decides it.

  test('returns false when env var is unset (safe default)', () => {
    mockIsClerkEnabled.mockReturnValue(true)
    expect(featureFlags.postgresSource()).toBe(false)
  })

  test('returns false when env var is "false"', () => {
    setEnv('VITE_FEATURE_POSTGRES_SOURCE', 'false')
    expect(featureFlags.postgresSource()).toBe(false)
  })

  test('returns false when env var is "1" (not strictly "true")', () => {
    setEnv('VITE_FEATURE_POSTGRES_SOURCE', '1')
    expect(featureFlags.postgresSource()).toBe(false)
  })

  test('returns true when env var is "true" EVEN IF Clerk is disabled', () => {
    // The OSS-parity requirement: no auth backend must not gate Postgres.
    mockIsClerkEnabled.mockReturnValue(false)
    setEnv('VITE_FEATURE_POSTGRES_SOURCE', 'true')
    expect(featureFlags.postgresSource()).toBe(true)
  })
})

describe('featureFlags — both flags disabled simultaneously', () => {
  test('neither flag leaks into the other: conversationDb false does not affect userConnectionsDb', () => {
    // Only userConnectionsDb enabled.
    setEnv('VITE_FEATURE_USER_CONNECTIONS_DB', 'true')
    mockIsClerkEnabled.mockReturnValue(true)
    expect(featureFlags.conversationDb()).toBe(false)
    expect(featureFlags.userConnectionsDb()).toBe(true)
  })

  test('neither flag leaks into the other: userConnectionsDb false does not affect conversationDb', () => {
    // Only conversationDb enabled.
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'true')
    mockIsClerkEnabled.mockReturnValue(true)
    expect(featureFlags.conversationDb()).toBe(true)
    expect(featureFlags.userConnectionsDb()).toBe(false)
  })
})

describe('isFeatureEnabled', () => {
  test('returns false for conversationDb when env var is unset', () => {
    expect(isFeatureEnabled('conversationDb')).toBe(false)
  })

  test('returns false for userConnectionsDb when env var is unset', () => {
    expect(isFeatureEnabled('userConnectionsDb')).toBe(false)
  })

  test('returns false for webhookSubscriptions when env var is unset', () => {
    expect(isFeatureEnabled('webhookSubscriptions')).toBe(false)
  })

  test('returns true for conversationDb when env + Clerk are enabled', () => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'true')
    mockIsClerkEnabled.mockReturnValue(true)
    expect(isFeatureEnabled('conversationDb')).toBe(true)
  })

  test('returns true for userConnectionsDb when env + Clerk are enabled', () => {
    setEnv('VITE_FEATURE_USER_CONNECTIONS_DB', 'true')
    mockIsClerkEnabled.mockReturnValue(true)
    expect(isFeatureEnabled('userConnectionsDb')).toBe(true)
  })

  test('returns true for webhookSubscriptions when env + Clerk are enabled', () => {
    setEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS', 'true')
    mockIsClerkEnabled.mockReturnValue(true)
    expect(isFeatureEnabled('webhookSubscriptions')).toBe(true)
  })

  test('delegates to featureFlags[flag]() — result matches direct call', () => {
    setEnv('VITE_FEATURE_CONVERSATION_DB', 'true')
    mockIsClerkEnabled.mockReturnValue(true)
    expect(isFeatureEnabled('conversationDb')).toBe(
      featureFlags.conversationDb()
    )
  })
})

describe('featureFlags — shape invariants', () => {
  test('has exactly the expected keys', () => {
    expect(Object.keys(featureFlags).sort()).toEqual([
      'conversationDb',
      'postgresSource',
      'userConnectionsDb',
      'webhookSubscriptions',
    ])
  })

  test('all flag values are callable functions', () => {
    for (const key of Object.keys(featureFlags) as FeatureFlagName[]) {
      expect(typeof featureFlags[key]).toBe('function')
    }
  })

  test('each flag is callable and returns a boolean', () => {
    for (const key of Object.keys(featureFlags) as FeatureFlagName[]) {
      const result = featureFlags[key]()
      expect(typeof result).toBe('boolean')
    }
  })
})

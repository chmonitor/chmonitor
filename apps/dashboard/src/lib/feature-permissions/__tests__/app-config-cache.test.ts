/**
 * getAppConfig() is called on every gated request via authorizeFeatureRequest.
 * It reads only immutable-at-runtime env vars, so it must parse once per isolate
 * and return the cached value thereafter. These tests pin that behavior: the
 * cache survives an env change and only re-parses after the test-only reset.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// readEnv() in server.ts prefers the cloudflare:workers `env` binding, then
// falls back to process.env. Mock the binding empty so the tests drive config
// purely through process.env.
mock.module('cloudflare:workers', () => ({ env: {} }))

const FEATURE_ENV_KEYS = [
  'CHM_AUTH_PROVIDER',
  'CHM_DISABLED_FEATURES',
  'CHM_AUTH_REQUIRED_FEATURES',
  'NEXT_PUBLIC_AUTH_PROVIDER',
]

function clearFeatureEnv(): void {
  for (const key of FEATURE_ENV_KEYS) delete process.env[key]
}

describe('getAppConfig cache', () => {
  beforeEach(async () => {
    clearFeatureEnv()
    const { _resetAppConfigCache } = await import('../server')
    _resetAppConfigCache()
  })

  afterEach(async () => {
    clearFeatureEnv()
    const { _resetAppConfigCache } = await import('../server')
    _resetAppConfigCache()
  })

  test('parses once, then returns the cached instance', async () => {
    const { getAppConfig } = await import('../server')

    process.env.CHM_DISABLED_FEATURES = 'agent'
    const first = getAppConfig()
    expect(first.features).toEqual({ agent: { enabled: false } })

    const second = getAppConfig()
    // Same object reference → no re-parse happened.
    expect(second).toBe(first)
  })

  test('cached value ignores later env changes until reset', async () => {
    const { getAppConfig, _resetAppConfigCache } = await import('../server')

    process.env.CHM_DISABLED_FEATURES = 'agent'
    const cached = getAppConfig()
    expect(cached.features).toEqual({ agent: { enabled: false } })

    // Mutating env after the first parse must NOT change the cached result.
    process.env.CHM_DISABLED_FEATURES = 'tables'
    expect(getAppConfig()).toBe(cached)
    expect(getAppConfig().features).toEqual({ agent: { enabled: false } })

    // After reset it re-parses and reflects the new env.
    _resetAppConfigCache()
    const reparsed = getAppConfig()
    expect(reparsed).not.toBe(cached)
    expect(reparsed.features).toEqual({ tables: { enabled: false } })
  })
})

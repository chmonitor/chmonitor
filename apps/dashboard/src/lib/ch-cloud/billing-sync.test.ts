import type { CloudBillingSyncEnv } from './billing-sync'

import { getCloudBillingUsage } from './billing-sync'
import { beforeEach, describe, expect, test } from 'bun:test'
import { resetMemoryCacheInstance } from '@/lib/cache'

// Never resolves anywhere real — proves the "unconfigured" tests below never
// reach the network (they'd hang/throw if this were actually invoked).
const failIfCalled = async (): Promise<string[]> => {
  throw new Error('resolveHostAddresses should not be called when disabled')
}

const FULL_ENV: CloudBillingSyncEnv = {
  CHM_FEATURE_CLOUD_BILLING_SYNC: 'true',
  CLICKHOUSE_CLOUD_API_KEY_ID: 'key-id',
  CLICKHOUSE_CLOUD_API_KEY_SECRET: 'key-secret',
  CLICKHOUSE_CLOUD_ORG_ID: 'org-123',
}

beforeEach(() => {
  resetMemoryCacheInstance()
})

describe('getCloudBillingUsage — off-by-default Cloud cost sync', () => {
  test('is a true no-op with no env configured at all', async () => {
    const result = await getCloudBillingUsage(
      {},
      { resolveHostAddresses: failIfCalled }
    )
    expect(result).toEqual({ enabled: false })
  })

  test('is a no-op when the feature flag is off, even with full credentials', async () => {
    const result = await getCloudBillingUsage(
      { ...FULL_ENV, CHM_FEATURE_CLOUD_BILLING_SYNC: 'false' },
      { resolveHostAddresses: failIfCalled }
    )
    expect(result).toEqual({ enabled: false })
  })

  test('is a no-op when the flag is on but a credential is missing', async () => {
    const { CLICKHOUSE_CLOUD_API_KEY_SECRET: _drop, ...incomplete } = FULL_ENV
    const result = await getCloudBillingUsage(incomplete, {
      resolveHostAddresses: failIfCalled,
    })
    expect(result).toEqual({ enabled: false })
  })

  test('never fabricates data: a blocked endpoint reports ok:false, not a crash or fake numbers', async () => {
    // Fully configured, but the (injected) DNS resolution for the API host
    // lands on an internal address — the shared SSRF guard
    // (`@/lib/browser-connections/host-url`) must reject it exactly like it
    // would for a user-supplied ClickHouse host.
    const result = await getCloudBillingUsage(FULL_ENV, {
      resolveHostAddresses: async () => ['10.0.0.5'],
    })
    expect(result.enabled).toBe(true)
    if (result.enabled) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/internal addresses are not allowed/i)
      }
    }
  })
})

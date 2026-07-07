import {
  buildPingPayload,
  DEFAULT_TELEMETRY_ENDPOINT,
  getPingEndpoint,
  PING_INTERVAL_MS,
  type PingDeps,
  runInstancePing,
  shouldPing,
} from './instance-ping'
import { describe, expect, test } from 'bun:test'

// ─────────────────────────────────────────────────────────────────────────────
// shouldPing

describe('shouldPing', () => {
  const NOW = 1_000_000_000_000

  test('returns true when never pinged (null lastPingAt)', () => {
    expect(shouldPing(NOW, null)).toBe(true)
  })

  test('returns false when pinged just now', () => {
    expect(shouldPing(NOW, NOW)).toBe(false)
  })

  test('returns false when less than interval has elapsed', () => {
    expect(shouldPing(NOW, NOW - PING_INTERVAL_MS + 1)).toBe(false)
  })

  test('returns true when exactly interval has elapsed', () => {
    expect(shouldPing(NOW, NOW - PING_INTERVAL_MS)).toBe(true)
  })

  test('returns true when more than interval has elapsed', () => {
    expect(shouldPing(NOW, NOW - PING_INTERVAL_MS - 1)).toBe(true)
  })

  test('respects custom intervalMs', () => {
    expect(shouldPing(NOW, NOW - 500, 1000)).toBe(false)
    expect(shouldPing(NOW, NOW - 1000, 1000)).toBe(true)
  })

  test('returns true when recently pinged but without version, and now version is provided', () => {
    expect(shouldPing(NOW, NOW - 100, PING_INTERVAL_MS, null, '24.8')).toBe(
      true
    )
    expect(shouldPing(NOW, NOW - 100, PING_INTERVAL_MS, '', '24.8')).toBe(true)
  })

  test('returns false when recently pinged with a version, and same or new version is provided', () => {
    expect(shouldPing(NOW, NOW - 100, PING_INTERVAL_MS, '24.8', '24.8')).toBe(
      false
    )
    expect(shouldPing(NOW, NOW - 100, PING_INTERVAL_MS, '24.8', '25.1')).toBe(
      false
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildPingPayload

describe('buildPingPayload', () => {
  test('includes instance_hash and deploy_target', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      deployTarget: 'docker',
    })
    expect(payload.instance_hash).toBe('abc123')
    expect(payload.deploy_target).toBe('docker')
  })

  test('includes ch_version truncated to major.minor', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      version: '24.8.1.2',
      deployTarget: 'cf',
    })
    expect(payload.ch_version).toBe('24.8')
  })

  test('omits ch_version when version is undefined', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      deployTarget: 'docker',
    })
    expect('ch_version' in payload).toBe(false)
  })

  test('omits ch_version when version is unparseable', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      version: 'not-a-version',
      deployTarget: 'docker',
    })
    expect('ch_version' in payload).toBe(false)
  })

  test('never includes raw instance id — only the provided hash', () => {
    const rawId = 'raw-uuid-value'
    const payload = buildPingPayload({
      instanceHash: 'hashed-value',
      deployTarget: 'docker',
    })
    // The raw id should not appear anywhere in the payload values
    expect(Object.values(payload).includes(rawId)).toBe(false)
    expect(payload.instance_hash).toBe('hashed-value')
  })

  test('includes chm_version and install_place when provided', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      deployTarget: 'docker',
      chmVersion: '0.3.1',
      installPlace: 'abcde12345',
    })
    expect(payload.chm_version).toBe('0.3.1')
    expect(payload.install_place).toBe('abcde12345')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fake deps factory

function makeDeps(
  overrides: Partial<PingDeps> & {
    storageOverrides?: Record<string, string>
    capturedPosts?: Array<{ url: string; body: string }>
  } = {}
): PingDeps & {
  store: Record<string, string>
  posts: Array<{ url: string; body: string }>
} {
  const store: Record<string, string> = {
    ...(overrides.storageOverrides ?? {}),
  }
  const posts: Array<{ url: string; body: string }> =
    overrides.capturedPosts ?? []

  return {
    enabled: true,
    endpoint: 'https://example.com/ping',
    now: 1_700_000_000_000,
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v
    },
    randomId: () => 'test-uuid-1234',
    hash: async (s) => `hash:${s}`,
    post: async (url, body) => {
      posts.push({ url, body })
    },
    version: '24.8.1.2',
    deployTarget: 'docker',
    detectFlavor: () => 'oss',
    detectCountry: () => 'us',
    detectPlatform: () => 'linux',
    computeInstallPlace: async () => 'test-install-place-hash',
    store,
    posts,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runInstancePing — gate tests (MUST prove post is NOT called)

describe('runInstancePing gates', () => {
  test('returns skipped-disabled when enabled:false, post NOT called', async () => {
    const deps = makeDeps({ enabled: false })
    const result = await runInstancePing(deps)
    expect(result).toBe('skipped-disabled')
    expect(deps.posts).toHaveLength(0)
  })

  test('returns skipped-no-endpoint when endpoint is empty, post NOT called', async () => {
    const deps = makeDeps({ endpoint: '' })
    const result = await runInstancePing(deps)
    expect(result).toBe('skipped-no-endpoint')
    expect(deps.posts).toHaveLength(0)
  })

  test('returns skipped-too-soon when pinged recently, post NOT called', async () => {
    const now = 1_700_000_000_000
    const deps = makeDeps({
      now,
      storageOverrides: {
        chm_telemetry_last_ping_at: String(now - 100), // 100ms ago — far below interval
        chm_telemetry_last_ping_version: '24.8.1.2',
      },
    })
    const result = await runInstancePing(deps)
    expect(result).toBe('skipped-too-soon')
    expect(deps.posts).toHaveLength(0)
  })

  test('pings again within interval if previous ping had no version and now version is provided', async () => {
    const now = 1_700_000_000_000
    const deps = makeDeps({
      now,
      version: '24.8.1.2',
      storageOverrides: {
        chm_telemetry_last_ping_at: String(now - 100),
      },
    })
    const result = await runInstancePing(deps)
    expect(result).toBe('pinged')
    expect(deps.posts).toHaveLength(1)
    expect(deps.store.chm_telemetry_last_ping_version).toBe('24.8.1.2')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runInstancePing — happy path

describe('runInstancePing happy path', () => {
  test('returns pinged and calls post exactly once when all conditions met', async () => {
    const deps = makeDeps() // no lastPingAt → first ping
    const result = await runInstancePing(deps)
    expect(result).toBe('pinged')
    expect(deps.posts).toHaveLength(1)
  })

  test('post receives correct endpoint URL', async () => {
    const deps = makeDeps({ endpoint: 'https://collect.example.com/ping' })
    await runInstancePing(deps)
    expect(deps.posts[0].url).toBe('https://collect.example.com/ping')
  })

  test('payload contains hashed instance_id (not raw), ch_version (major.minor), deploy_target', async () => {
    const deps = makeDeps({ version: '24.8.1.2', deployTarget: 'cf' })
    await runInstancePing(deps)

    const body = JSON.parse(deps.posts[0].body) as Record<string, string>
    // instance_hash must be the hash of the instance id, never the raw id
    expect(body.instance_hash).toBe('hash:test-uuid-1234')
    expect(body.instance_hash).not.toBe('test-uuid-1234')
    // version is truncated to major.minor
    expect(body.ch_version).toBe('24.8')
    expect(body.deploy_target).toBe('cf')
  })

  test('persists lastPingAt in storage after ping', async () => {
    const now = 1_700_000_000_000
    const deps = makeDeps({ now })
    await runInstancePing(deps)
    expect(deps.store.chm_telemetry_last_ping_at).toBe(String(now))
  })

  test('persists instance id in storage when not previously stored', async () => {
    const deps = makeDeps()
    await runInstancePing(deps)
    expect(deps.store.chm_telemetry_instance_id).toBe('test-uuid-1234')
  })

  test('reuses existing stored instance id (does not regenerate)', async () => {
    let randomCalled = 0
    const deps = makeDeps({
      storageOverrides: { chm_telemetry_instance_id: 'existing-stable-id' },
      randomId: () => {
        randomCalled++
        return 'new-uuid'
      },
    })
    await runInstancePing(deps)

    // randomId must NOT have been called — the stored ID was reused
    expect(randomCalled).toBe(0)
    expect(deps.store.chm_telemetry_instance_id).toBe('existing-stable-id')
    // The hash is of the EXISTING id
    const body = JSON.parse(deps.posts[0].body) as Record<string, string>
    expect(body.instance_hash).toBe('hash:existing-stable-id')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runInstancePing — error resilience

describe('runInstancePing error resilience', () => {
  test('does not reject when post throws', async () => {
    const deps = makeDeps({
      post: async () => {
        throw new Error('network failure')
      },
    })
    await expect(runInstancePing(deps)).resolves.toBe('pinged')
  })

  test('still persists lastPingAt when post throws', async () => {
    const now = 1_700_000_000_000
    const deps = makeDeps({
      now,
      post: async () => {
        throw new Error('network failure')
      },
    })
    await runInstancePing(deps)
    expect(deps.store.chm_telemetry_last_ping_at).toBe(String(now))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint resolution + kill-switch.
//
// Telemetry is ON by default and the endpoint defaults to the project collector,
// so getPingEndpoint({}) resolves to DEFAULT_TELEMETRY_ENDPOINT. Setting the env
// to an explicit empty string is the hard kill-switch: '' is preserved and
// runInstancePing makes zero network calls.

describe('endpoint resolution and kill-switch', () => {
  test('getPingEndpoint falls back to the default collector when unset', () => {
    expect(getPingEndpoint({})).toBe(DEFAULT_TELEMETRY_ENDPOINT)
    expect(getPingEndpoint({ UNRELATED: 'foo' })).toBe(
      DEFAULT_TELEMETRY_ENDPOINT
    )
  })

  test('explicit endpoint env overrides the default', () => {
    expect(
      getPingEndpoint({ CHM_TELEMETRY_ENDPOINT: 'https://t.example/v1/ping' })
    ).toBe('https://t.example/v1/ping')
  })

  test('explicit empty endpoint is preserved as the hard kill-switch', () => {
    expect(getPingEndpoint({ CHM_TELEMETRY_ENDPOINT: '' })).toBe('')
  })

  test('runInstancePing never calls post when endpoint is empty — even with enabled:true', async () => {
    const posts: Array<{ url: string; body: string }> = []
    const result = await runInstancePing(
      makeDeps({
        enabled: true,
        endpoint: '', // explicit kill-switch
        post: async (url, body) => {
          posts.push({ url, body })
        },
      })
    )
    expect(result).toBe('skipped-no-endpoint')
    expect(posts).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cadence: after a successful ping, skips until interval elapses

describe('runInstancePing cadence', () => {
  test('skips on second call within interval', async () => {
    const now = 1_700_000_000_000
    const deps = makeDeps({ now })

    const first = await runInstancePing(deps)
    expect(first).toBe('pinged')

    // Advance time by less than interval and run again
    const deps2 = makeDeps({
      now: now + PING_INTERVAL_MS - 1,
      storageOverrides: { ...deps.store },
    })
    const second = await runInstancePing(deps2)
    expect(second).toBe('skipped-too-soon')
    expect(deps2.posts).toHaveLength(0)
  })

  test('pings again once interval has elapsed', async () => {
    const now = 1_700_000_000_000
    const deps = makeDeps({ now })
    await runInstancePing(deps)

    const deps2 = makeDeps({
      now: now + PING_INTERVAL_MS,
      storageOverrides: { ...deps.store },
    })
    const second = await runInstancePing(deps2)
    expect(second).toBe('pinged')
    expect(deps2.posts).toHaveLength(1)
  })
})

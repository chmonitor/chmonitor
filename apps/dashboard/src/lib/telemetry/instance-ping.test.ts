import {
  buildPingPayload,
  DEFAULT_TELEMETRY_ENDPOINT,
  getPingEndpoint,
  PING_INTERVAL_MS,
  type PingDeps,
  type PingPayload,
  runInstancePing,
  sha256hex,
  shouldPing,
} from './instance-ping'
import { describe, expect, test } from 'bun:test'

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

describe('buildPingPayload', () => {
  test('is a `ping` event whose id is the instance hash and props carry deploy_target', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      deployTarget: 'docker',
    })
    expect(payload).toEqual({
      event: 'ping',
      id: 'abc123',
      props: { deploy_target: 'docker' },
    })
  })

  test('puts the ClickHouse version in props.ch_version, truncated to major.minor', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      version: '24.8.1.2',
      deployTarget: 'cf',
    })
    expect(payload.props.ch_version).toBe('24.8')
  })

  test('omits ch_version when version is undefined', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      deployTarget: 'docker',
    })
    expect('ch_version' in payload.props).toBe(false)
  })

  test('omits ch_version when version is unparseable', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      version: 'not-a-version',
      deployTarget: 'docker',
    })
    expect('ch_version' in payload.props).toBe(false)
  })

  test('never includes raw instance id — only the provided hash', () => {
    const rawId = 'raw-uuid-value'
    const payload = buildPingPayload({
      instanceHash: 'hashed-value',
      deployTarget: 'docker',
    })
    expect(JSON.stringify(payload)).not.toContain(rawId)
    expect(payload.id).toBe('hashed-value')
  })

  // `version` (ClickHouse) and `chmVersion` (product) are easy to swap: the
  // service's `version` dimension is the app version, so a swap would chart
  // ClickHouse versions as chmonitor releases.
  test('top-level version is the CHM product version, not the ClickHouse version', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      version: '24.8.1.2',
      chmVersion: '0.3.1',
      deployTarget: 'docker',
    })
    expect(payload.version).toBe('0.3.1')
    expect(payload.props.ch_version).toBe('24.8')
  })

  test('maps platform to os and flavor to props.ch_flavor', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      deployTarget: 'docker',
      chFlavor: 'altinity',
      platform: 'linux',
    })
    expect(payload.os).toBe('linux')
    expect(payload.props.ch_flavor).toBe('altinity')
  })

  // Dropped on purpose: country is derived server-side, and the old
  // install_place / license_key identifiers must not go to public telemetry.
  test('carries exactly the fields the service accepts — nothing legacy', () => {
    const payload = buildPingPayload({
      instanceHash: 'abc123',
      version: '24.8.1.2',
      deployTarget: 'docker',
      chFlavor: 'oss',
      platform: 'linux',
      chmVersion: '0.3.1',
    })
    expect(Object.keys(payload).sort()).toEqual([
      'event',
      'id',
      'os',
      'props',
      'version',
    ])
    expect(Object.keys(payload.props).sort()).toEqual([
      'ch_flavor',
      'ch_version',
      'deploy_target',
    ])
  })
})

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
    detectPlatform: () => 'linux',
    store,
    posts,
    ...overrides,
  }
}

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

  test('payload is a ping event with the hashed id (not raw), ch_version (major.minor), deploy_target', async () => {
    const deps = makeDeps({ version: '24.8.1.2', deployTarget: 'cf' })
    await runInstancePing(deps)

    const body = JSON.parse(deps.posts[0].body) as PingPayload
    expect(body.event).toBe('ping')
    // id must be the hash of the instance id, never the raw id
    expect(body.id).toBe('hash:test-uuid-1234')
    expect(body.id).not.toBe('test-uuid-1234')
    // version is truncated to major.minor
    expect(body.props.ch_version).toBe('24.8')
    expect(body.props.deploy_target).toBe('cf')
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
      // A secret is present, so this id is already salted: it must be reused.
      // The unsalted shape is covered by the legacy-upgrade suite below.
      storageOverrides: {
        chm_telemetry_instance_id: 'existing-stable-id',
        chm_telemetry_instance_secret: 'existing-secret',
      },
      randomId: () => {
        randomCalled++
        return 'new-uuid'
      },
    })
    await runInstancePing(deps)

    // randomId must NOT have been called — the stored ID was reused
    expect(randomCalled).toBe(0)
    expect(deps.store.chm_telemetry_instance_id).toBe('existing-stable-id')
    // The hash is of the EXISTING id: same id → user counts stay continuous
    const body = JSON.parse(deps.posts[0].body) as PingPayload
    expect(body.id).toBe('hash:existing-stable-id')
  })
})

// Without a per-install secret the raw id is just `dashboardHost|chHost`, so two
// installs behind the same hostnames collide and the hash is reversible by
// dictionary attack. These pin the salt.
describe('instance id is salted per install', () => {
  const savedWindow = globalThis.window

  function withWindow<T>(fn: () => T): T {
    // @ts-expect-error — bun test runs without a DOM
    globalThis.window = { location: { hostname: 'dash.example.com' } }
    try {
      return fn()
    } finally {
      if (savedWindow === undefined) {
        // @ts-expect-error
        delete globalThis.window
      } else {
        globalThis.window = savedWindow
      }
    }
  }

  async function pingWithSecret(secret: string, chHostname: string) {
    const deps = makeDeps({
      chHostname,
      randomId: () => secret,
    })
    await runInstancePing(deps)
    const body = JSON.parse(deps.posts[0].body) as PingPayload
    return { body, store: deps.store }
  }

  test('two installs with identical hostnames get different ids', async () => {
    const { body: a, store: storeA } = await withWindow(() =>
      pingWithSecret('secret-aaa', 'ch.internal.example')
    )
    const { body: b, store: storeB } = await withWindow(() =>
      pingWithSecret('secret-bbb', 'ch.internal.example')
    )

    // Same dashboard host + same ClickHouse host, different installs.
    expect(storeA.chm_telemetry_instance_id).not.toBe(
      storeB.chm_telemetry_instance_id
    )
    expect(a.id).not.toBe(b.id)
  })

  test('the raw id embeds the secret and both hostnames', async () => {
    const { body, store } = await withWindow(() =>
      pingWithSecret('secret-ccc', 'ch.internal.example')
    )
    expect(store.chm_telemetry_instance_id).toBe(
      'secret-ccc|dash.example.com|ch.internal.example'
    )
    // makeDeps' fake hash is a passthrough, so assert the wiring, not secrecy:
    // the transmitted id is the hash OF the raw id.
    expect(body.id).toBe(`hash:${store.chm_telemetry_instance_id}`)
  })

  test('the real SHA-256 hash does not contain the raw id', async () => {
    const deps = makeDeps({
      chHostname: 'ch.internal.example',
      randomId: () => 'secret-ddd',
      hash: sha256hex,
    })
    await withWindow(() => runInstancePing(deps))
    const body = JSON.parse(deps.posts[0].body) as PingPayload

    expect(body.id).toMatch(/^[0-9a-f]{64}$/)
    expect(body.id).not.toContain('secret-ddd')
    expect(body.id).not.toContain('ch.internal.example')
  })

  test('the secret is minted once and reused on later pings', async () => {
    let minted = 0
    const deps = makeDeps({
      chHostname: 'ch.internal.example',
      randomId: () => {
        minted++
        return 'secret-once'
      },
    })
    await withWindow(() => runInstancePing(deps))
    const firstId = deps.store.chm_telemetry_instance_id

    await withWindow(() => runInstancePing(deps))

    expect(minted).toBe(1)
    expect(deps.store.chm_telemetry_instance_id).toBe(firstId)
  })
})

// An install that pinged before the salt has a stored `hostname|chHostname` id
// and no secret, so it matches both pre-existing reuse conditions. It must be
// re-minted once, then stay stable — otherwise the privacy fix never reaches the
// installs that already existed.
describe('upgrading from a legacy unsalted instance id', () => {
  const savedWindow = globalThis.window
  const LEGACY_ID = 'dash.example.com|ch.internal.example'

  function withWindow<T>(fn: () => T): T {
    // @ts-expect-error — bun test runs without a DOM
    globalThis.window = { location: { hostname: 'dash.example.com' } }
    try {
      return fn()
    } finally {
      if (savedWindow === undefined) {
        // @ts-expect-error
        delete globalThis.window
      } else {
        globalThis.window = savedWindow
      }
    }
  }

  function legacyDeps() {
    return makeDeps({
      chHostname: 'ch.internal.example',
      randomId: () => 'fresh-secret',
      storageOverrides: {
        chm_telemetry_instance_id: LEGACY_ID,
        chm_telemetry_ch_hostname: 'ch.internal.example',
      },
    })
  }

  test('re-mints the legacy id on the first ping after upgrade', async () => {
    const deps = legacyDeps()
    await withWindow(() => runInstancePing(deps))

    expect(deps.store.chm_telemetry_instance_id).not.toBe(LEGACY_ID)
    expect(deps.store.chm_telemetry_instance_id).toBe(
      'fresh-secret|dash.example.com|ch.internal.example'
    )
    expect(deps.store.chm_telemetry_instance_secret).toBe('fresh-secret')
  })

  test('the re-minted id stays stable on later pings', async () => {
    const deps = legacyDeps()
    await withWindow(() => runInstancePing(deps))
    const afterUpgrade = deps.store.chm_telemetry_instance_id

    // Past the cadence window so the ping actually runs again.
    deps.now = 1_700_000_000_000 + PING_INTERVAL_MS
    await withWindow(() => runInstancePing(deps))

    expect(deps.store.chm_telemetry_instance_id).toBe(afterUpgrade)
  })

  test('leaves an already-salted id untouched', async () => {
    const salted = 'fresh-secret|dash.example.com|ch.internal.example'
    let minted = 0
    const deps = makeDeps({
      chHostname: 'ch.internal.example',
      randomId: () => {
        minted++
        return 'should-not-be-used'
      },
      storageOverrides: {
        chm_telemetry_instance_id: salted,
        chm_telemetry_instance_secret: 'fresh-secret',
        chm_telemetry_ch_hostname: 'ch.internal.example',
      },
    })
    await withWindow(() => runInstancePing(deps))

    expect(deps.store.chm_telemetry_instance_id).toBe(salted)
    expect(deps.store.chm_telemetry_instance_secret).toBe('fresh-secret')
    expect(minted).toBe(0)
  })
})

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

// Telemetry is ON by default and the endpoint defaults to the project collector,
// so getPingEndpoint({}) resolves to DEFAULT_TELEMETRY_ENDPOINT. Setting the env
// to an explicit empty string is the hard kill-switch: '' is preserved and
// runInstancePing makes zero network calls.

describe('endpoint resolution and kill-switch', () => {
  test('the default is the shared telemetry service project endpoint', () => {
    expect(DEFAULT_TELEMETRY_ENDPOINT).toBe(
      'https://telemetry.anyr.workers.dev/chmonitor'
    )
  })

  test('getPingEndpoint falls back to the default collector when unset', () => {
    expect(getPingEndpoint({})).toBe(DEFAULT_TELEMETRY_ENDPOINT)
    expect(getPingEndpoint({ UNRELATED: 'foo' })).toBe(
      DEFAULT_TELEMETRY_ENDPOINT
    )
  })

  test('explicit endpoint env overrides the default', () => {
    expect(
      getPingEndpoint({ CHM_TELEMETRY_ENDPOINT: 'https://t.example/collect' })
    ).toBe('https://t.example/collect')
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

// A license key is an identifier: it must never reach public telemetry.
describe('runInstancePing never sends a license key', () => {
  const POLAR_CHECKOUT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  test('posted body has no license_key and does not contain the key value', async () => {
    // Simulate a stale caller still handing the old deps in: they must be ignored.
    const deps = {
      ...makeDeps(),
      licenseKey: POLAR_CHECKOUT_ID,
      resolveLicenseKey: async () => POLAR_CHECKOUT_ID,
    } as PingDeps & { posts: Array<{ url: string; body: string }> }
    await runInstancePing(deps)
    expect(deps.posts).toHaveLength(1)
    expect(deps.posts[0].body).not.toContain('license')
    expect(deps.posts[0].body).not.toContain(POLAR_CHECKOUT_ID)
  })

  test('posted body has no country or install_place', async () => {
    const deps = makeDeps()
    await runInstancePing(deps)
    expect(deps.posts[0].body).not.toContain('country')
    expect(deps.posts[0].body).not.toContain('install_place')
  })
})

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

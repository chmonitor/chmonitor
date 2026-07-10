import {
  createHostValidationFetch,
  validateHostUrl,
  validatePostgresHost,
} from './host-url'
import { describe, expect, mock, test } from 'bun:test'

// Injected DNS resolvers (the 2nd param) so tests never hit the network.
const resolveLoopback = async () => ['127.0.0.1']
const resolvePublic = async () => ['93.184.216.34']
// A resolver factory for the IPv6 cases below: each test targets a fake
// hostname that "resolves" to the IPv6 address under test, driving the
// `addresses.some(isInternalIp)` branch (the resolved-address path) rather
// than the IP-literal-in-URL path — same `isInternalIp` matrix either way.
const resolveIpv6 = (address: string) => async () => [address]

describe('validateHostUrl — private-host SSRF guard', () => {
  test('blocks private / LAN / CGNAT(Tailscale) / loopback by default', async () => {
    // allowPrivate = false (the default everywhere, and forced in cloud).
    expect(
      await validateHostUrl('http://192.168.1.10:8123', resolvePublic, false)
    ).not.toBeNull()
    expect(
      await validateHostUrl('http://10.0.0.5:8123', resolvePublic, false)
    ).not.toBeNull()
    expect(
      // 100.64.0.0/10 is Tailscale's CGNAT range.
      await validateHostUrl('http://100.64.0.1:8123', resolvePublic, false)
    ).not.toBeNull()
    expect(
      await validateHostUrl('http://localhost:8123', resolveLoopback, false)
    ).not.toBeNull()
  })

  test('allows them when allowPrivate = true (self-host opt-in)', async () => {
    expect(
      await validateHostUrl('http://192.168.1.10:8123', resolvePublic, true)
    ).toBeNull()
    expect(
      await validateHostUrl('http://100.64.0.1:8123', resolvePublic, true)
    ).toBeNull()
    // A tailnet hostname that resolves to a loopback/private address.
    expect(
      await validateHostUrl('http://duet-ubuntu:8123', resolveLoopback, true)
    ).toBeNull()
  })

  test('non-http(s) scheme is still rejected even with allowPrivate', async () => {
    expect(
      await validateHostUrl('ftp://192.168.1.10', resolvePublic, true)
    ).not.toBeNull()
  })

  test('a public host is allowed regardless of the flag', async () => {
    expect(
      await validateHostUrl(
        'https://my.clickhouse.cloud:8443',
        resolvePublic,
        false
      )
    ).toBeNull()
  })
})

describe('validateHostUrl — IPv6 internal-range SSRF guard', () => {
  test('blocks IPv6 loopback (::1)', async () => {
    expect(
      await validateHostUrl('http://ipv6-host:8123', resolveIpv6('::1'), false)
    ).not.toBeNull()
  })

  test('blocks IPv6 ULA (fc00::/7, e.g. fd00::1)', async () => {
    expect(
      await validateHostUrl(
        'http://ipv6-host:8123',
        resolveIpv6('fd00::1'),
        false
      )
    ).not.toBeNull()
  })

  test('blocks IPv6 link-local (fe80::/10)', async () => {
    expect(
      await validateHostUrl(
        'http://ipv6-host:8123',
        resolveIpv6('fe80::1'),
        false
      )
    ).not.toBeNull()
  })

  test('blocks an IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)', async () => {
    expect(
      await validateHostUrl(
        'http://ipv6-host:8123',
        resolveIpv6('::ffff:127.0.0.1'),
        false
      )
    ).not.toBeNull()
  })

  test('blocks a 6to4 address wrapping a private IPv4 (2002:0a00:0001:: → 10.0.0.1)', async () => {
    expect(
      await validateHostUrl(
        'http://ipv6-host:8123',
        resolveIpv6('2002:0a00:0001::'),
        false
      )
    ).not.toBeNull()
  })

  test('allows a public IPv6 address (proves the guard is not blocking all v6)', async () => {
    expect(
      await validateHostUrl(
        'http://ipv6-host:8123',
        resolveIpv6('2606:4700:4700::1111'),
        false
      )
    ).toBeNull()
  })
})

// isCloudflareWorkers() (imported by host-url.ts) is a plain process.env read
// (CF_PAGES / CLOUDFLARE_WORKERS=1), evaluated fresh on every call rather than
// cached at import time — so it can be driven directly via its real env-var
// contract instead of mock.module-ing the specifier. That sidesteps the
// ordering hazard a module mock would hit here: this file's `createHostValidationFetch`
// import above is static, so a mock.module call placed after it would register
// too late to affect host-url.ts's already-bound reference (see
// routes/api/v1/webhooks/polar.test.ts, which avoids this by mock.module-ing
// before a *dynamic* import of the module under test).
describe('createHostValidationFetch — Workers hostname guard', () => {
  test('rejects a non-IP-literal host with the DNS-pinning error when running under Workers', async () => {
    const resolveShouldNotBeCalled = mock(async () => {
      throw new Error('resolver should not be called')
    })

    process.env.CLOUDFLARE_WORKERS = '1'
    try {
      const fetchFn = createHostValidationFetch(resolveShouldNotBeCalled)

      await expect(fetchFn('https://hooks.slack.com/x')).rejects.toThrow(
        'Browser connection hostnames require Node.js DNS pinning'
      )
    } finally {
      delete process.env.CLOUDFLARE_WORKERS
    }

    // The Workers guard short-circuits before any DNS resolution is attempted.
    expect(resolveShouldNotBeCalled).not.toHaveBeenCalled()
  })
})

describe('createHostValidationFetch — validation runs at fetch time', () => {
  test('rejects an internal resolved address before any socket dispatch', async () => {
    const resolveInternal = async () => ['10.0.0.5']
    const originalFetch = globalThis.fetch
    const fetchSpy = mock(async () => {
      throw new Error('a real network fetch should never be attempted')
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    // Force the Node (non-Workers) pinning path regardless of ambient env,
    // so this assertion isn't coupled to CI happening not to set these.
    delete process.env.CLOUDFLARE_WORKERS
    delete process.env.CF_PAGES

    try {
      const fetchFn = createHostValidationFetch(resolveInternal)

      await expect(fetchFn('http://internal-host:8123/')).rejects.toThrow(
        'Connections to internal addresses are not allowed.'
      )
    } finally {
      globalThis.fetch = originalFetch
    }

    // Proves the guard re-validates on the pinned path: it rejects before
    // fetchPinnedToValidatedAddresses (or the Workers pass-through) ever
    // dispatches a real request.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('validatePostgresHost — TCP SSRF guard', () => {
  const resolvePublic = async () => ['93.184.216.34']
  const resolveLoopback = async () => ['127.0.0.1']

  test('blocks private / loopback / CGNAT by default', async () => {
    expect(
      await validatePostgresHost('192.168.1.10', 5432, resolvePublic, false)
    ).not.toBeNull()
    expect(
      await validatePostgresHost('10.0.0.5', 5432, resolvePublic, false)
    ).not.toBeNull()
    expect(
      await validatePostgresHost('100.64.0.1', 5432, resolvePublic, false)
    ).not.toBeNull()
    expect(
      await validatePostgresHost('localhost', 5432, resolveLoopback, false)
    ).not.toBeNull()
    // A public hostname that secretly resolves to a loopback address.
    expect(
      await validatePostgresHost('sneaky.example', 5432, resolveLoopback, false)
    ).not.toBeNull()
  })

  test('allows private hosts when allowPrivate = true (self-host opt-in)', async () => {
    expect(
      await validatePostgresHost('127.0.0.1', 54329, resolveLoopback, true)
    ).toBeNull()
    expect(
      await validatePostgresHost('192.168.1.10', 5432, resolvePublic, true)
    ).toBeNull()
  })

  test('allows a public host on a valid port', async () => {
    expect(
      await validatePostgresHost('db.example.com', 5432, resolvePublic, false)
    ).toBeNull()
  })

  test('rejects out-of-range and non-integer ports', async () => {
    expect(
      await validatePostgresHost('db.example.com', 0, resolvePublic, true)
    ).not.toBeNull()
    expect(
      await validatePostgresHost('db.example.com', 70000, resolvePublic, true)
    ).not.toBeNull()
    expect(
      await validatePostgresHost('db.example.com', 5432.5, resolvePublic, true)
    ).not.toBeNull()
  })

  test('rejects a URL-shaped host (must be a bare hostname/IP)', async () => {
    expect(
      await validatePostgresHost(
        'postgres://db.example.com',
        5432,
        resolvePublic,
        true
      )
    ).not.toBeNull()
    expect(
      await validatePostgresHost('db.example.com/x', 5432, resolvePublic, true)
    ).not.toBeNull()
  })

  test('rejects an empty host', async () => {
    expect(
      await validatePostgresHost('', 5432, resolvePublic, true)
    ).not.toBeNull()
  })
})

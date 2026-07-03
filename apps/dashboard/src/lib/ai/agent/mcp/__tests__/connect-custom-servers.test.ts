/**
 * Unit tests for connect-custom-servers.
 *
 * The SSRF guard + name sanitiser are tested as pure functions. The connect /
 * validate / merge lifecycle is exercised through an INJECTED client factory
 * (never the real `createMCPClient`), so no network call is made and the
 * close-always / failure-isolation invariants can be asserted deterministically.
 */

import type { McpClientFactory } from '../connect-custom-servers'

import {
  connectCustomMcpServers,
  isAllowedMcpUrl,
  loadUserRegisteredServers,
  mergeMcpServers,
  sanitizeServerName,
  validateServer,
} from '../connect-custom-servers'
import { describe, expect, mock, test } from 'bun:test'

// ---------------------------------------------------------------------------
// isAllowedMcpUrl
// ---------------------------------------------------------------------------

// Deterministic DNS stub so tests never touch the network. Maps the domains
// used below to fixed public/private addresses; anything else resolves public.
const PUBLIC_A = '93.184.216.34'
const stubDns = async (host: string): Promise<readonly string[]> => {
  const map: Record<string, string[]> = {
    'mcp.example.com': [PUBLIC_A],
    'api.acme.io': [PUBLIC_A],
    // DNS-rebinding style: public-looking name that points at internal ranges.
    'rebind.internal.test': ['10.0.0.5'],
    'metadata.internal.test': ['169.254.169.254'],
    'v6-private.internal.test': ['fc00::1'],
    'mixed.internal.test': [PUBLIC_A, '192.168.1.10'],
  }
  return map[host] ?? [PUBLIC_A]
}

describe('isAllowedMcpUrl', () => {
  // ---- allowed cases ----

  test('accepts https on a public domain', async () => {
    expect(await isAllowedMcpUrl('https://mcp.example.com/mcp', stubDns)).toBe(
      true
    )
  })

  test('accepts https on a public domain with path and port', async () => {
    expect(
      await isAllowedMcpUrl('https://api.acme.io:8443/mcp/v1', stubDns)
    ).toBe(true)
  })

  test('accepts http on localhost', async () => {
    expect(await isAllowedMcpUrl('http://localhost/mcp', stubDns)).toBe(true)
  })

  test('accepts http on localhost with port', async () => {
    expect(await isAllowedMcpUrl('http://localhost:3001/mcp', stubDns)).toBe(
      true
    )
  })

  test('accepts http on 127.0.0.1', async () => {
    expect(await isAllowedMcpUrl('http://127.0.0.1:8080/mcp', stubDns)).toBe(
      true
    )
  })

  test('accepts http on [::1] (IPv6 loopback)', async () => {
    expect(await isAllowedMcpUrl('http://[::1]:9000/mcp', stubDns)).toBe(true)
  })

  test('accepts https on localhost (https loopback is fine)', async () => {
    expect(await isAllowedMcpUrl('https://localhost/mcp', stubDns)).toBe(true)
  })

  // ---- rejected: protocol ----

  test('rejects non-url string', async () => {
    expect(await isAllowedMcpUrl('not a url', stubDns)).toBe(false)
  })

  test('rejects ftp protocol', async () => {
    expect(await isAllowedMcpUrl('ftp://example.com/mcp', stubDns)).toBe(false)
  })

  test('rejects ws protocol', async () => {
    expect(await isAllowedMcpUrl('ws://example.com/mcp', stubDns)).toBe(false)
  })

  // ---- rejected: http on public hosts ----

  test('rejects http on a public domain', async () => {
    expect(await isAllowedMcpUrl('http://example.com/mcp', stubDns)).toBe(false)
  })

  test('rejects http on an IP that is not loopback', async () => {
    expect(await isAllowedMcpUrl('http://8.8.8.8/mcp', stubDns)).toBe(false)
  })

  // ---- rejected: private IPv4 ranges over https ----

  test('rejects cloud metadata IP 169.254.169.254', async () => {
    expect(
      await isAllowedMcpUrl('https://169.254.169.254/latest/meta-data', stubDns)
    ).toBe(false)
  })

  test('rejects link-local 169.254.x.x', async () => {
    expect(await isAllowedMcpUrl('https://169.254.0.1/mcp', stubDns)).toBe(
      false
    )
  })

  test('rejects private class A 10.x.x.x', async () => {
    expect(await isAllowedMcpUrl('https://10.0.0.1/mcp', stubDns)).toBe(false)
  })

  test('rejects private class B lower bound 172.16.x.x', async () => {
    expect(await isAllowedMcpUrl('https://172.16.0.1/mcp', stubDns)).toBe(false)
  })

  test('rejects private class B upper bound 172.31.x.x', async () => {
    expect(await isAllowedMcpUrl('https://172.31.255.255/mcp', stubDns)).toBe(
      false
    )
  })

  test('allows 172.15.x.x (just outside class B range)', async () => {
    expect(await isAllowedMcpUrl('https://172.15.0.1/mcp', stubDns)).toBe(true)
  })

  test('allows 172.32.x.x (just outside class B range)', async () => {
    expect(await isAllowedMcpUrl('https://172.32.0.1/mcp', stubDns)).toBe(true)
  })

  test('rejects private class C 192.168.x.x', async () => {
    expect(await isAllowedMcpUrl('https://192.168.1.1/mcp', stubDns)).toBe(
      false
    )
  })

  test('rejects loopback 127.x.x.x', async () => {
    expect(await isAllowedMcpUrl('https://127.0.0.2/mcp', stubDns)).toBe(false)
  })

  test('rejects 0.0.0.0', async () => {
    expect(await isAllowedMcpUrl('https://0.0.0.0/mcp', stubDns)).toBe(false)
  })

  // ---- hardening: DNS names resolving to internal addresses ----

  test('rejects a public name that resolves to a private IPv4 (rebind)', async () => {
    expect(
      await isAllowedMcpUrl('https://rebind.internal.test/mcp', stubDns)
    ).toBe(false)
  })

  test('rejects a public name that resolves to the metadata IP', async () => {
    expect(
      await isAllowedMcpUrl('https://metadata.internal.test/mcp', stubDns)
    ).toBe(false)
  })

  test('rejects a public name that resolves to a private IPv6 (ULA)', async () => {
    expect(
      await isAllowedMcpUrl('https://v6-private.internal.test/mcp', stubDns)
    ).toBe(false)
  })

  test('rejects when ANY resolved address is internal', async () => {
    expect(
      await isAllowedMcpUrl('https://mixed.internal.test/mcp', stubDns)
    ).toBe(false)
  })

  // ---- hardening: IPv6 literals (only ::1 allowed) ----

  test('rejects public IPv6 literal', async () => {
    expect(
      await isAllowedMcpUrl('https://[2606:4700:4700::1111]/mcp', stubDns)
    ).toBe(false)
  })

  test('rejects private IPv6 literal (ULA)', async () => {
    expect(await isAllowedMcpUrl('https://[fc00::1]/mcp', stubDns)).toBe(false)
  })

  test('rejects IPv4-mapped IPv6 loopback literal', async () => {
    expect(
      await isAllowedMcpUrl('https://[::ffff:127.0.0.1]/mcp', stubDns)
    ).toBe(false)
  })

  // ---- hardening: numeric-encoded IPv4 ----

  test('rejects decimal-encoded IPv4 (2130706433 = 127.0.0.1)', async () => {
    expect(await isAllowedMcpUrl('https://2130706433/mcp', stubDns)).toBe(false)
  })

  test('rejects hex-encoded IPv4 (0x7f000001)', async () => {
    expect(await isAllowedMcpUrl('https://0x7f000001/mcp', stubDns)).toBe(false)
  })

  test('rejects octal-encoded IPv4 (0177.0.0.1)', async () => {
    expect(await isAllowedMcpUrl('https://0177.0.0.1/mcp', stubDns)).toBe(false)
  })

  test('rejects short-form IPv4 (127.1)', async () => {
    expect(await isAllowedMcpUrl('https://127.1/mcp', stubDns)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sanitizeServerName
// ---------------------------------------------------------------------------

describe('sanitizeServerName', () => {
  test('lowercases and keeps alphanum', () => {
    expect(sanitizeServerName('MyServer')).toBe('myserver')
  })

  test('replaces spaces with underscores', () => {
    expect(sanitizeServerName('My MCP Server')).toBe('my_mcp_server')
  })

  test('replaces hyphens with underscores', () => {
    expect(sanitizeServerName('my-server')).toBe('my_server')
  })

  test('collapses consecutive non-alphanum into single underscore', () => {
    expect(sanitizeServerName('a -- b')).toBe('a_b')
  })

  test('strips leading and trailing underscores', () => {
    expect(sanitizeServerName('---server---')).toBe('server')
  })

  test('truncates to 20 chars', () => {
    expect(sanitizeServerName('averylongservername123456')).toBe(
      'averylongservername1'
    )
    expect(sanitizeServerName('averylongservername123456').length).toBe(20)
  })

  test('returns "server" for empty or symbols-only input', () => {
    expect(sanitizeServerName('')).toBe('server')
    expect(sanitizeServerName('---')).toBe('server')
  })
})

// ---------------------------------------------------------------------------
// validateServer — SSRF pre-check + close-always
// ---------------------------------------------------------------------------

const PUBLIC_ENDPOINT = 'https://mcp.example.com/mcp'

describe('validateServer', () => {
  test('rejects a private-host URL without opening a client', async () => {
    const createClient = mock<McpClientFactory>(async () => ({
      tools: async () => ({}),
      close: async () => {},
    }))
    const res = await validateServer(
      { id: '1', name: 'evil', endpoint: 'https://rebind.internal.test/mcp' },
      { createClient, resolveHostAddresses: stubDns }
    )
    expect(res.ok).toBe(false)
    expect(createClient).not.toHaveBeenCalled()
  })

  test('returns the advertised tool names and closes on success', async () => {
    const close = mock(async () => {})
    const createClient: McpClientFactory = async () => ({
      tools: async () => ({ search: {}, fetch: {} }),
      close,
    })
    const res = await validateServer(
      { id: '1', name: 'ok', endpoint: PUBLIC_ENDPOINT },
      { createClient, resolveHostAddresses: stubDns }
    )
    expect(res.ok).toBe(true)
    expect(res.tools).toEqual(['search', 'fetch'])
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('closes the client even when tools() throws', async () => {
    const close = mock(async () => {})
    const createClient: McpClientFactory = async () => ({
      tools: async () => {
        throw new Error('listing failed: boom')
      },
      close,
    })
    const res = await validateServer(
      { id: '1', name: 'flaky', endpoint: PUBLIC_ENDPOINT },
      { createClient, resolveHostAddresses: stubDns }
    )
    expect(res.ok).toBe(false)
    expect(res.error).toContain('boom')
    expect(close).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// connectCustomMcpServers — per-server isolation + SSRF
// ---------------------------------------------------------------------------

describe('connectCustomMcpServers', () => {
  test('isolates a failing server; the others still return prefixed tools', async () => {
    const closeGood = mock(async () => {})
    const createClient: McpClientFactory = async ({ serverName }) => {
      if (serverName === 'bad') {
        return {
          tools: async () => {
            throw new Error('nope')
          },
          close: async () => {},
        }
      }
      return { tools: async () => ({ ping: {} }), close: closeGood }
    }

    const result = await connectCustomMcpServers(
      [
        { id: 'g', name: 'good', endpoint: PUBLIC_ENDPOINT },
        { id: 'b', name: 'bad', endpoint: 'https://api.acme.io/mcp' },
      ],
      { createClient, resolveHostAddresses: stubDns }
    )

    expect(Object.keys(result.tools)).toEqual(['mcp_good_ping'])
    const statusById = Object.fromEntries(
      result.statuses.map((s) => [s.id, s.status])
    )
    expect(statusById).toEqual({ g: 'connected', b: 'error' })

    await result.closeAll()
    expect(closeGood).toHaveBeenCalledTimes(1)
  })

  test('rejects a private-host server before connecting', async () => {
    const createClient = mock<McpClientFactory>(async () => ({
      tools: async () => ({}),
      close: async () => {},
    }))
    const result = await connectCustomMcpServers(
      [
        {
          id: 'x',
          name: 'evil',
          endpoint: 'https://metadata.internal.test/mcp',
        },
      ],
      { createClient, resolveHostAddresses: stubDns }
    )
    expect(result.statuses[0]?.status).toBe('error')
    expect(createClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// mergeMcpServers — dedupe across body + registry sources
// ---------------------------------------------------------------------------

describe('mergeMcpServers', () => {
  test('de-duplicates by normalized endpoint, earlier lists win', () => {
    const body = [
      { id: 'a', name: 'body', endpoint: 'https://mcp.example.com/mcp/' },
    ]
    const registered = [
      { id: 'b', name: 'reg', endpoint: 'https://MCP.example.com/mcp' },
      { id: 'c', name: 'other', endpoint: 'https://api.acme.io/mcp' },
    ]
    const merged = mergeMcpServers(body, registered)
    expect(merged.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

// ---------------------------------------------------------------------------
// loadUserRegisteredServers — store mapping + best-effort
// ---------------------------------------------------------------------------

describe('loadUserRegisteredServers', () => {
  test('maps a user’s enabled registrations into connect inputs', async () => {
    const store = {
      listEnabledConnectInputs: async (userId: string) => {
        expect(userId).toBe('user-a')
        return [
          {
            id: '1',
            name: 'slack',
            url: 'https://slack.example.com/mcp',
            transport: 'http' as const,
            auth: { kind: 'bearer' as const, token: 'tok' },
          },
        ]
      },
    }
    const servers = await loadUserRegisteredServers('user-a', { store })
    expect(servers).toEqual([
      {
        id: '1',
        name: 'slack',
        endpoint: 'https://slack.example.com/mcp',
        transport: 'http',
        auth: { kind: 'bearer', token: 'tok' },
      },
    ])
  })

  test('returns [] when the store throws (best-effort / OSS no D1)', async () => {
    const store = {
      listEnabledConnectInputs: async () => {
        throw new Error('no D1 binding')
      },
    }
    expect(await loadUserRegisteredServers('u', { store })).toEqual([])
  })
})

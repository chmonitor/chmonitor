/**
 * Tests for the Firecrawl hostname allowlist.
 *
 * These encode WHY the policy exists: keyless Firecrawl can scrape any URL, so
 * a deployment-level allowlist must fail open when unset (OSS default) and
 * fail closed on scrape/crawl/map hosts when set — including a user-registered
 * Firecrawl server that tries to bypass by renaming.
 */

import {
  extractHttpHostsFromArgs,
  firecrawlBlockedMessage,
  firstDisallowedFirecrawlHost,
  hostMatchesFirecrawlAllowlist,
  isFirecrawlMcpServer,
  parseFirecrawlAllowDomains,
  wrapFirecrawlToolExecute,
} from '../firecrawl-allowlist'
import { describe, expect, mock, test } from 'bun:test'

const ALLOW = ['clickhouse.com', 'chmonitor.dev', '*.github.com'] as const

describe('parseFirecrawlAllowDomains', () => {
  test('empty, unset, and whitespace mean no restriction (fail-open OSS default)', () => {
    expect(parseFirecrawlAllowDomains(undefined)).toEqual([])
    expect(parseFirecrawlAllowDomains('')).toEqual([])
    expect(parseFirecrawlAllowDomains('   ')).toEqual([])
    expect(parseFirecrawlAllowDomains('\n\t')).toEqual([])
  })

  test('splits commas, trims, lowercases, strips trailing dots, drops empty tokens', () => {
    expect(
      parseFirecrawlAllowDomains(' ClickHouse.com. , , chmonitor.dev ,')
    ).toEqual(['clickhouse.com', 'chmonitor.dev'])
  })

  test('keeps *. as a subdomain-only marker', () => {
    expect(parseFirecrawlAllowDomains('*.Example.com.,github.com')).toEqual([
      '*.example.com',
      'github.com',
    ])
  })

  test('skips IP literals and encoded IPv4 so operators cannot allowlist an address', () => {
    expect(
      parseFirecrawlAllowDomains(
        'clickhouse.com,8.8.8.8,127.0.0.1,::1,[::1],2130706433,0x7f000001,0177.0.0.1,127.1,chmonitor.dev'
      )
    ).toEqual(['clickhouse.com', 'chmonitor.dev'])
  })
})

describe('hostMatchesFirecrawlAllowlist', () => {
  test('apex token allows the apex and any subdomain so docs.clickhouse.com is covered', () => {
    expect(hostMatchesFirecrawlAllowlist('clickhouse.com', ALLOW)).toBe(true)
    expect(hostMatchesFirecrawlAllowlist('docs.clickhouse.com', ALLOW)).toBe(
      true
    )
    expect(hostMatchesFirecrawlAllowlist('foo.bar.clickhouse.com', ALLOW)).toBe(
      true
    )
    expect(hostMatchesFirecrawlAllowlist('notclickhouse.com', ALLOW)).toBe(
      false
    )
  })

  test('*.github.com allows subdomains but not the apex', () => {
    expect(hostMatchesFirecrawlAllowlist('github.com', ALLOW)).toBe(false)
    expect(hostMatchesFirecrawlAllowlist('docs.github.com', ALLOW)).toBe(true)
    expect(hostMatchesFirecrawlAllowlist('api.github.com', ALLOW)).toBe(true)
  })

  test('port is ignored so https://host:8443 still matches', () => {
    expect(
      hostMatchesFirecrawlAllowlist('docs.clickhouse.com:8443', ALLOW)
    ).toBe(true)
    expect(hostMatchesFirecrawlAllowlist('evil.example:443', ALLOW)).toBe(false)
  })

  test('matching is case-insensitive and strips a trailing dot', () => {
    expect(hostMatchesFirecrawlAllowlist('Docs.ClickHouse.COM', ALLOW)).toBe(
      true
    )
    expect(hostMatchesFirecrawlAllowlist('chmonitor.dev.', ALLOW)).toBe(true)
  })

  test('IP hosts never match, even if the caller listed one', () => {
    expect(hostMatchesFirecrawlAllowlist('8.8.8.8', ['8.8.8.8'])).toBe(false)
    expect(hostMatchesFirecrawlAllowlist('127.0.0.1', ALLOW)).toBe(false)
  })

  test('empty allowlist allows every host (no extra restriction)', () => {
    expect(hostMatchesFirecrawlAllowlist('evil.example', [])).toBe(true)
  })
})

describe('extractHttpHostsFromArgs', () => {
  test('reads url and urls because those are Firecrawl scrape/crawl/map inputs', () => {
    expect(
      extractHttpHostsFromArgs({ url: 'https://docs.clickhouse.com/sql' })
    ).toEqual(['docs.clickhouse.com'])
    expect(
      extractHttpHostsFromArgs({
        urls: [
          'https://chmonitor.dev/docs',
          'http://github.com/chmonitor/chmonitor',
        ],
      })
    ).toEqual(['chmonitor.dev', 'github.com'])
  })

  test('also picks nested http(s) strings so a renamed arg cannot skip the check', () => {
    expect(
      extractHttpHostsFromArgs({
        options: { target: 'https://evil.example/secret' },
      })
    ).toEqual(['evil.example'])
  })

  test('search-only query has no hosts so web search stays allowed', () => {
    expect(
      extractHttpHostsFromArgs({ query: 'clickhouse merge tree' })
    ).toEqual([])
    expect(extractHttpHostsFromArgs({ q: 'site:clickhouse.com' })).toEqual([])
  })

  test('url fields accept a bare host; non-http schemes are ignored', () => {
    expect(extractHttpHostsFromArgs({ url: 'clickhouse.com' })).toEqual([
      'clickhouse.com',
    ])
    expect(extractHttpHostsFromArgs({ url: 'ftp://files.example/a' })).toEqual(
      []
    )
  })
})

describe('firstDisallowedFirecrawlHost', () => {
  test('returns the first host not on the list so the error names the blocked site', () => {
    expect(
      firstDisallowedFirecrawlHost(
        {
          urls: ['https://docs.clickhouse.com/a', 'https://evil.example/b'],
        },
        ALLOW
      )
    ).toBe('evil.example')
  })

  test('returns undefined when every extracted host is allowed or none exist', () => {
    expect(
      firstDisallowedFirecrawlHost(
        { url: 'https://docs.clickhouse.com/a' },
        ALLOW
      )
    ).toBeUndefined()
    expect(
      firstDisallowedFirecrawlHost({ query: 'clickhouse' }, ALLOW)
    ).toBeUndefined()
  })
})

describe('isFirecrawlMcpServer', () => {
  test('builtin id, sanitized name firecrawl, or mcp.firecrawl.dev cannot bypass', () => {
    expect(
      isFirecrawlMcpServer({
        id: 'builtin-firecrawl',
        sanitizedName: 'firecrawl',
        endpoint: 'https://mcp.firecrawl.dev/v2/mcp',
      })
    ).toBe(true)
    expect(
      isFirecrawlMcpServer({
        id: 'user-1',
        sanitizedName: 'firecrawl',
        endpoint: 'https://example.com/mcp',
      })
    ).toBe(true)
    expect(
      isFirecrawlMcpServer({
        id: 'user-2',
        sanitizedName: 'docs',
        endpoint: 'https://mcp.firecrawl.dev/v2/mcp',
      })
    ).toBe(true)
    expect(
      isFirecrawlMcpServer({
        id: 'user-3',
        sanitizedName: 'slack',
        endpoint: 'https://mcp.slack.com/mcp',
      })
    ).toBe(false)
  })
})

describe('wrapFirecrawlToolExecute', () => {
  test('allowed host calls through to the inner execute', async () => {
    const inner = mock(async (input: unknown) => ({ ok: true, input }))
    const tool = wrapFirecrawlToolExecute({ execute: inner }, ALLOW) as {
      execute: (input: unknown) => Promise<unknown>
    }
    const input = { url: 'https://docs.clickhouse.com/engines' }
    await expect(tool.execute(input)).resolves.toEqual({ ok: true, input })
    expect(inner).toHaveBeenCalledTimes(1)
  })

  test('blocked host does not call the inner execute and returns the policy error', async () => {
    const inner = mock(async () => {
      throw new Error('should not run')
    })
    const tool = wrapFirecrawlToolExecute({ execute: inner }, ALLOW) as {
      execute: (input: unknown) => Promise<unknown>
    }
    await expect(
      tool.execute({ url: 'https://evil.example/secret' })
    ).resolves.toBe(firecrawlBlockedMessage('evil.example'))
    expect(inner).not.toHaveBeenCalled()
  })

  test('unset allowlist is a no-op wrap: every host calls through', async () => {
    const inner = mock(async () => 'scraped')
    const original = { execute: inner }
    expect(wrapFirecrawlToolExecute(original, [])).toBe(original)
    const tool = wrapFirecrawlToolExecute(original, []) as {
      execute: (input: unknown) => Promise<unknown>
    }
    await expect(
      tool.execute({ url: 'https://evil.example/secret' })
    ).resolves.toBe('scraped')
    expect(inner).toHaveBeenCalledTimes(1)
  })

  test('search-only args stay allowed when the allowlist is set', async () => {
    const inner = mock(async () => ['hit'])
    const tool = wrapFirecrawlToolExecute({ execute: inner }, ALLOW) as {
      execute: (input: unknown) => Promise<unknown>
    }
    await expect(tool.execute({ query: 'clickhouse' })).resolves.toEqual([
      'hit',
    ])
    expect(inner).toHaveBeenCalledTimes(1)
  })
})

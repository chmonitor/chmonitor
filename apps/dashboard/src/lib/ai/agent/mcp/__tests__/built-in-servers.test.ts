import {
  FIRECRAWL_MCP_SERVER,
  FIRECRAWL_MCP_URL,
  getBuiltInMcpServers,
  isFirecrawlMcpEnabled,
} from '../built-in-servers'
import { MCP_SERVER_TEMPLATES } from '../server-templates'
import { describe, expect, test } from 'bun:test'

describe('isFirecrawlMcpEnabled', () => {
  test('defaults on when unset or empty', () => {
    expect(isFirecrawlMcpEnabled(undefined)).toBe(true)
    expect(isFirecrawlMcpEnabled('')).toBe(true)
    expect(isFirecrawlMcpEnabled('  ')).toBe(true)
  })

  test('explicit off values disable', () => {
    for (const raw of ['false', '0', 'off', 'no', 'FALSE']) {
      expect(isFirecrawlMcpEnabled(raw)).toBe(false)
    }
  })

  test('explicit on values enable', () => {
    for (const raw of ['true', '1', 'on', 'yes']) {
      expect(isFirecrawlMcpEnabled(raw)).toBe(true)
    }
  })

  test('junk values fail open to enabled', () => {
    expect(isFirecrawlMcpEnabled('maybe')).toBe(true)
  })
})

describe('getBuiltInMcpServers', () => {
  test('includes keyless Firecrawl by default', () => {
    const servers = getBuiltInMcpServers({})
    expect(servers).toEqual([FIRECRAWL_MCP_SERVER])
    expect(servers[0]?.auth).toEqual({ kind: 'none' })
    expect(servers[0]?.endpoint).toBe(FIRECRAWL_MCP_URL)
  })

  test('omits Firecrawl when CHM_AGENT_FIRECRAWL_MCP is off', () => {
    expect(getBuiltInMcpServers({ CHM_AGENT_FIRECRAWL_MCP: 'false' })).toEqual(
      []
    )
  })
})

describe('MCP_SERVER_TEMPLATES', () => {
  test('lists Firecrawl first with no auth', () => {
    const firecrawl = MCP_SERVER_TEMPLATES.find((t) => t.id === 'firecrawl')
    expect(firecrawl).toBeDefined()
    expect(firecrawl?.authKind).toBe('none')
    expect(firecrawl?.url).toBe(FIRECRAWL_MCP_URL)
    expect(MCP_SERVER_TEMPLATES[0]?.id).toBe('firecrawl')
  })
})

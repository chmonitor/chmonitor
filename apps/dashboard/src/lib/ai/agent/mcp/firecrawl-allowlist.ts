/**
 * Deployment-level hostname allowlist for Firecrawl MCP tool calls.
 *
 * `CHM_AGENT_FIRECRAWL_ALLOW_DOMAINS` is optional. Empty / unset / whitespace
 * means no extra restriction (current OSS behavior). When set, scrape/crawl/map
 * URLs are checked before the outbound MCP execute; search-only calls (no URL)
 * stay allowed.
 */

import { FIRECRAWL_MCP_URL } from './mcp-urls'

export const FIRECRAWL_ALLOW_DOMAINS_ENV = 'CHM_AGENT_FIRECRAWL_ALLOW_DOMAINS'

const FIRECRAWL_MCP_HOST = new URL(FIRECRAWL_MCP_URL).hostname.toLowerCase()

/**
 * Parse `CHM_AGENT_FIRECRAWL_ALLOW_DOMAINS`. Comma-separated hostnames, optional
 * leading `*.` for subdomain-only match. Empty tokens ignored; lowercased;
 * trailing dots stripped. IP literals and encoded IPv4 tokens are skipped —
 * only hostname tokens are kept.
 */
export function parseFirecrawlAllowDomains(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []

  const tokens: string[] = []
  for (const part of raw.split(',')) {
    const token = part.trim().toLowerCase().replace(/\.+$/, '')
    if (!token) continue

    const wildcard = token.startsWith('*.')
    const host = wildcard ? token.slice(2).replace(/\.+$/, '') : token
    // Hostname tokens only: skip IPs, empty `*.`, and junk with no letters.
    if (!host || looksLikeIpToken(host) || !/[a-z]/.test(host)) continue

    tokens.push(wildcard ? `*.${host}` : host)
  }
  return tokens
}

export function getFirecrawlAllowlistFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return parseFirecrawlAllowDomains(env.CHM_AGENT_FIRECRAWL_ALLOW_DOMAINS)
}

/**
 * Case-insensitive hostname match. Port is ignored. `example.com` matches the
 * apex and any subdomain (suffix with a dot). `*.example.com` matches
 * subdomains only, not the apex.
 */
export function hostMatchesFirecrawlAllowlist(
  hostname: string,
  allowlist: readonly string[]
): boolean {
  if (allowlist.length === 0) return true

  const host = normalizeHostname(hostname)
  if (!host || looksLikeIpToken(host)) return false

  for (const token of allowlist) {
    if (token.startsWith('*.')) {
      const domain = token.slice(2)
      if (domain && host !== domain && host.endsWith(`.${domain}`)) return true
      continue
    }
    if (host === token || host.endsWith(`.${token}`)) return true
  }
  return false
}

/**
 * Pull http(s) hosts out of Firecrawl tool args. Reads `url` / `urls` (scheme
 * optional — those are the scrape/crawl/map fields) plus any string that
 * parses as an `http:`/`https:` URL, so a renamed nested arg cannot skip the
 * check. Search-only `{ query }` yields none.
 */
export function extractHttpHostsFromArgs(input: unknown): string[] {
  const hosts: string[] = []
  collectHosts(input, undefined, hosts)
  return hosts
}

/** First extracted host that is not on the allowlist, if any. */
export function firstDisallowedFirecrawlHost(
  input: unknown,
  allowlist: readonly string[]
): string | undefined {
  if (allowlist.length === 0) return undefined
  for (const host of extractHttpHostsFromArgs(input)) {
    if (!hostMatchesFirecrawlAllowlist(host, allowlist)) return host
  }
  return undefined
}

export function firecrawlBlockedMessage(host: string): string {
  return `Firecrawl blocked: host "${host}" is not on ${FIRECRAWL_ALLOW_DOMAINS_ENV}`
}

/**
 * True for the built-in Firecrawl server, a registration whose sanitized name
 * is `firecrawl`, or an endpoint whose host is `mcp.firecrawl.dev` — so a
 * user-registered Firecrawl URL cannot bypass the policy by renaming.
 */
export function isFirecrawlMcpServer(server: {
  id: string
  sanitizedName: string
  endpoint: string
}): boolean {
  if (server.id === 'builtin-firecrawl') return true
  if (server.sanitizedName === 'firecrawl') return true
  return endpointHost(server.endpoint) === FIRECRAWL_MCP_HOST
}

/**
 * Wrap an AI SDK tool `execute` so disallowed hosts never reach Firecrawl.
 * Empty allowlist is a no-op (same object). Tools without `execute` pass through.
 */
export function wrapFirecrawlToolExecute(
  tool: unknown,
  allowlist: readonly string[]
): unknown {
  if (allowlist.length === 0 || !isRecord(tool)) return tool
  if (typeof tool.execute !== 'function') return tool

  const original = tool.execute.bind(tool) as (
    input: unknown,
    options?: unknown
  ) => unknown

  return {
    ...tool,
    execute: async (input: unknown, options?: unknown) => {
      const blocked = firstDisallowedFirecrawlHost(input, allowlist)
      if (blocked !== undefined) return firecrawlBlockedMessage(blocked)
      return original(input, options)
    },
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function collectHosts(
  value: unknown,
  parentKey: string | undefined,
  hosts: string[]
): void {
  if (typeof value === 'string') {
    const host = hostFromString(
      value,
      parentKey === 'url' || parentKey === 'urls'
    )
    if (host) hosts.push(host)
    return
  }
  if (Array.isArray(value)) {
    const childKey = parentKey === 'urls' ? 'urls' : undefined
    for (const item of value) collectHosts(item, childKey, hosts)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    collectHosts(child, key, hosts)
  }
}

function hostFromString(raw: string, urlField: boolean): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  const direct = parseHttpUrl(trimmed)
  if (direct) return direct

  // `url` / `urls` fields are Firecrawl's scrape inputs; accept a bare host.
  // Do not prefix when a scheme is already present (ftp: / javascript: / …).
  if (urlField && !trimmed.includes('://')) {
    return parseHttpUrl(`https://${trimmed}`)
  }
  return undefined
}

function parseHttpUrl(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  const host = normalizeHostname(url.hostname)
  return host || undefined
}

function normalizeHostname(raw: string): string {
  let host = raw
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')

  // Strip a trailing :port on hostname / IPv4. Skip IPv6 (multiple colons).
  const colon = host.lastIndexOf(':')
  if (
    colon !== -1 &&
    !host.slice(0, colon).includes(':') &&
    /^\d+$/.test(host.slice(colon + 1))
  ) {
    host = host.slice(0, colon)
  }

  return host.replace(/\.+$/, '')
}

/**
 * True for IPv4 quads, IPv6, and numeric-/hex-/octal-encoded IPv4 — the same
 * spirit as the MCP URL SSRF checks. Allowlist tokens that look like this are
 * dropped; extracted URL hosts that look like this never match.
 */
function looksLikeIpToken(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '')
  if (h.includes(':')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true
  if (/^0x[\da-f]+$/i.test(h)) return true
  if (/^\d+$/.test(h)) return true
  const parts = h.split('.')
  if (parts.length >= 2 && parts.every((p) => /^(0x[\da-f]+|\d+)$/i.test(p))) {
    return true
  }
  return false
}

function endpointHost(endpoint: string): string | undefined {
  try {
    return normalizeHostname(new URL(endpoint).hostname)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

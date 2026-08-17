/**
 * Deployment-level MCP servers the agent connects without user registration.
 *
 * Firecrawl's hosted MCP exposes scrape/search/parse on a keyless free tier
 * (rate-limited). Other tools still need a user-supplied API key — register
 * the same URL in the MCP Servers tab with a bearer token to upgrade.
 */

import type { CustomMcpServerInput } from './connect-custom-servers'

import { FIRECRAWL_MCP_URL } from './mcp-urls'

export { FIRECRAWL_MCP_URL }

export const FIRECRAWL_MCP_SERVER: CustomMcpServerInput = {
  id: 'builtin-firecrawl',
  name: 'firecrawl',
  endpoint: FIRECRAWL_MCP_URL,
  transport: 'http',
  auth: { kind: 'none' },
}

/**
 * Parse `CHM_AGENT_FIRECRAWL_MCP`. Unset / junk → enabled (opt-out).
 * Explicit `false` / `0` / `off` / `no` disables the built-in server.
 */
export function isFirecrawlMcpEnabled(
  raw: string | undefined = process.env.CHM_AGENT_FIRECRAWL_MCP
): boolean {
  if (raw === undefined || raw.trim() === '') return true
  const normalized = raw.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  return true
}

/** Built-in servers to merge after request-body + D1 registrations. */
export function getBuiltInMcpServers(
  env: NodeJS.ProcessEnv = process.env
): CustomMcpServerInput[] {
  if (!isFirecrawlMcpEnabled(env.CHM_AGENT_FIRECRAWL_MCP)) return []
  return [FIRECRAWL_MCP_SERVER]
}

/**
 * One-click presets for the MCP server manager form.
 * Test connection is the source of truth for the live endpoint.
 */

import type { McpAuthKind, McpTransport } from '@/lib/swr/use-mcp-registry'

import { FIRECRAWL_MCP_URL } from './mcp-urls'

export interface McpServerTemplate {
  id: string
  label: string
  url: string
  transport: McpTransport
  authKind: McpAuthKind
  authHeaderName?: string
  hint: string
}

export const MCP_SERVER_TEMPLATES: readonly McpServerTemplate[] = [
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    url: FIRECRAWL_MCP_URL,
    transport: 'http',
    authKind: 'none',
    hint: 'Keyless scrape, search, and parse (rate-limited). Optional bearer API key unlocks crawl/map/agent and higher limits.',
  },
  {
    id: 'github',
    label: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'http',
    authKind: 'bearer',
    hint: 'Use a GitHub personal access token as the bearer token.',
  },
  {
    id: 'slack',
    label: 'Slack',
    url: 'https://mcp.slack.com/mcp',
    transport: 'http',
    authKind: 'bearer',
    hint: 'Provide your Slack MCP bearer token (verify your workspace URL).',
  },
  {
    id: 'datadog',
    label: 'Datadog',
    url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
    transport: 'http',
    authKind: 'header',
    authHeaderName: 'DD-API-KEY',
    hint: 'Send your Datadog API key in the DD-API-KEY header.',
  },
]

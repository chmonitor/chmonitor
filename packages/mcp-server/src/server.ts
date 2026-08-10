import pkg from '../package.json'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import { registerAllTools } from './tools'
import { McpServer } from '@modelcontextprotocol/server'

/**
 * Build a fresh MCP server instance (one per request under createMcpHandler).
 *
 * Explicitly advertises tools/resources/prompts capabilities so 2026-07-28
 * clients (server/discover) and 2025-era initialize handshakes see a complete
 * capability set. Cache hints tell modern clients list results are stable for
 * a short window (tool catalog does not change mid-process).
 */
export function createMcpServer() {
  const server = new McpServer(
    {
      name: 'clickhouse-monitor',
      // Keep in lockstep with the @chm/mcp-server package version so discover /
      // serverInfo stamps match /api/v1/mcp/info and the server card.
      version: pkg.version,
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
      instructions:
        'Read-only ClickHouse monitoring tools. Use hostId to select among configured hosts (default 0). Prefer dedicated tools over freeform SQL when one fits.',
      // 2026-07-28 cacheable results — short private TTL for list/discover so
      // clients can avoid re-listing tools every turn without sharing caches.
      cacheHints: {
        'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
        'prompts/list': { ttlMs: 60_000, cacheScope: 'private' },
        'resources/list': { ttlMs: 60_000, cacheScope: 'private' },
        'resources/templates/list': { ttlMs: 60_000, cacheScope: 'private' },
        'server/discover': { ttlMs: 60_000, cacheScope: 'private' },
      },
    }
  )

  registerAllTools(server)
  registerResources(server)
  registerPrompts(server)

  return server
}

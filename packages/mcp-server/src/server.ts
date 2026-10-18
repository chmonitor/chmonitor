import pkg from '../package.json'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import { registerAllTools } from './tools'
import { McpServer } from '@modelcontextprotocol/server'

/** One instance per request under createMcpHandler. */
export function createMcpServer() {
  const server = new McpServer(
    {
      name: 'clickhouse-monitor',
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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { hostIdSchema, READONLY_ANNOTATIONS, runReadonlyQuery } from './helpers'

export function registerDatabasesTool(server: McpServer) {
  server.tool(
    'list_databases',
    'List all databases on the ClickHouse server with their engines and comments.',
    {
      hostId: hostIdSchema,
    },
    { ...READONLY_ANNOTATIONS, title: 'List Databases' },
    async ({ hostId }) =>
      runReadonlyQuery(
        'SELECT name, engine, comment FROM system.databases ORDER BY name',
        hostId
      )
  )
}

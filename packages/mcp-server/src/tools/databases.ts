import type { McpServer } from '@modelcontextprotocol/server'

import { hostIdSchema, READONLY_ANNOTATIONS, runReadonlyQuery } from './helpers'

export function registerDatabasesTool(server: McpServer) {
  server.registerTool(
    'list_databases',
    {
      title: 'List Databases',
      description:
        'List all databases on the ClickHouse server with their engines and comments.',
      inputSchema: {
        hostId: hostIdSchema,
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ hostId }) =>
      runReadonlyQuery(
        'SELECT name, engine, comment FROM system.databases ORDER BY name',
        hostId
      )
  )
}

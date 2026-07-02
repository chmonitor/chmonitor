import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { hostIdSchema, runReadonlyQuery } from './helpers'

export function registerMergesTool(server: McpServer) {
  server.tool(
    'get_merge_status',
    'Get currently running merge operations with progress, size, and elapsed time.',
    {
      hostId: hostIdSchema,
    },
    async ({ hostId }) =>
      runReadonlyQuery(
        'SELECT database, table, round(progress * 100, 2) AS progress_pct, formatReadableSize(total_size_bytes_compressed) AS size, elapsed FROM system.merges ORDER BY elapsed DESC',
        hostId
      )
  )
}

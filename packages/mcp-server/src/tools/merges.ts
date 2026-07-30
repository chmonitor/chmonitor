import type { McpServer } from '@modelcontextprotocol/server'

import { hostIdSchema, READONLY_ANNOTATIONS, runReadonlyQuery } from './helpers'

export function registerMergesTool(server: McpServer) {
  server.registerTool(
    'get_merge_status',
    {
      title: 'Get Merge Status',
      description:
        'Get currently running merge operations with progress, size, and elapsed time.',
      inputSchema: {
        hostId: hostIdSchema,
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ hostId }) =>
      runReadonlyQuery(
        'SELECT database, table, round(progress * 100, 2) AS progress_pct, formatReadableSize(total_size_bytes_compressed) AS size, elapsed FROM system.merges ORDER BY elapsed DESC',
        hostId
      )
  )
}

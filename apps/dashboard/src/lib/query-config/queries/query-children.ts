import type { QueryConfig } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'

/**
 * query-children: queries spawned by a given root query.
 *
 * ClickHouse links a distributed/parallel query's leaves to their root via
 * `initial_query_id`: every leaf row has the root's id in `initial_query_id`
 * and its own `query_id`. This config lists the leaves for a given root —
 * i.e. the child queries the /query detail page's "Child queries" section
 * renders.
 *
 * Filters to `type = 'QueryFinish'` so we show one finished row per child
 * (query_log records multiple event types per execution).
 *
 * All columns exist since well before the 20.0 version boundary.
 */
export const queryChildrenConfig: QueryConfig = {
  name: 'query-children',
  description:
    'Queries spawned by a distributed/parallel query (initial_query_id match)',
  docs: QUERY_LOG,
  permission: { feature: 'queries' },
  tableCheck: 'system.query_log',
  sql: `
    SELECT
      query_id,
      type,
      event_time,
      query_duration_ms / 1000 AS query_duration,
      user,
      query_kind,
      read_rows,
      formatReadableQuantity(read_rows) AS readable_read_rows,
      memory_usage,
      formatReadableSize(memory_usage) AS readable_memory_usage,
      substring(query, 1, 200) AS query_preview
    FROM system.query_log
    WHERE initial_query_id = {query_id: String}
      AND query_id != initial_query_id
      AND type = 'QueryFinish'
    ORDER BY event_time DESC
    LIMIT 50
  `,
  columns: [
    'query_id',
    'type',
    'event_time',
    'query_duration',
    'user',
    'query_kind',
    'read_rows',
    'readable_read_rows',
    'memory_usage',
    'readable_memory_usage',
    'query_preview',
  ],
  defaultParams: {
    query_id: '',
  },
}

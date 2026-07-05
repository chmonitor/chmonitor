import type { QueryConfig } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * query-detail: detailed information about a specific query execution.
 *
 * Version boundaries:
 * - 23.8+: `exception` (renamed from `exception_text`), `query_cache_usage` added
 * - 24.3+: `peak_threads_usage` added (not selected here)
 *
 * Columns verified in ClickHouse 26.5 system.query_log (88 columns):
 * query_id, type, event_time, query_duration_ms, query, formatted_query,
 * exception_code, exception (renamed from exception_text in 23.8), user,
 * query_kind, read_rows, written_rows, result_rows, memory_usage,
 * query_cache_usage, peak_threads_usage
 *
 * NOTE: peak_memory_usage does NOT exist in system.query_log.
 */

const baseSelect = `
    query_id,
    type,
    event_time,
    query_start_time,
    query_duration_ms / 1000 as query_duration,
    query,
    formatted_query AS readable_query,
    exception_code,
    user,
    query_kind,
    read_rows,
    formatReadableQuantity(read_rows) AS readable_read_rows,
    round(100 * read_rows / MAX(read_rows) OVER ()) AS pct_read_rows,
    read_bytes,
    formatReadableSize(read_bytes) AS readable_read_bytes,
    written_rows,
    formatReadableQuantity(written_rows) AS readable_written_rows,
    round(100 * written_rows / MAX(written_rows) OVER ()) AS pct_written_rows,
    written_bytes,
    formatReadableSize(written_bytes) AS readable_written_bytes,
    result_rows,
    formatReadableQuantity(result_rows) AS readable_result_rows,
    memory_usage,
    formatReadableSize(memory_usage) AS readable_memory_usage,
    round(100 * memory_usage / MAX(memory_usage) OVER ()) AS pct_memory_usage,
    client_name,
    client_hostname,
    initial_query_id,
    is_initial_query,
    initial_user,
    toString(databases) AS databases,
    toString(tables) AS tables,
    stack_trace,
    ProfileEvents,
    Settings`

export const queryDetailConfig: QueryConfig = {
  name: 'query-detail',
  defaultView: 'auto',
  card: { primary: 'query', badges: ['type', 'query_kind'] },
  description: 'Detailed information about a specific query execution',
  docs: QUERY_LOG,
  permission: { feature: 'queries' },
  tableCheck: 'system.query_log',
  sql: [
    {
      since: '20.0',
      description: 'Legacy: exception_text column, no query_cache_usage',
      sql: `
    SELECT
      ${baseSelect},
      exception_text
    FROM system.query_log
    WHERE query_id = {query_id: String}
    ORDER BY event_time DESC
    LIMIT 1
  `,
    },
    {
      since: '23.8',
      description:
        'exception column (renamed from exception_text), with query_cache_usage',
      sql: `
    SELECT
      ${baseSelect},
      exception AS exception_text,
      query_cache_usage
    FROM system.query_log
    WHERE query_id = {query_id: String}
    ORDER BY event_time DESC
    LIMIT 1
  `,
    },
  ],
  columns: [
    'query_id',
    'type',
    'event_time',
    'query_start_time',
    'query_duration',
    'user',
    'query_kind',
    'query_cache_usage',
    'readable_read_rows',
    'readable_read_bytes',
    'readable_written_rows',
    'readable_written_bytes',
    'readable_result_rows',
    'readable_memory_usage',
    'client_name',
    'client_hostname',
    'initial_query_id',
    'is_initial_query',
    'initial_user',
    'databases',
    'tables',
    'exception_code',
    'exception_text',
    'stack_trace',
    'ProfileEvents',
    'Settings',
    'query',
  ],
  columnFormats: {
    type: ColumnFormat.ColoredBadge,
    query_kind: ColumnFormat.ColoredBadge,
    query_cache_usage: ColumnFormat.ColoredBadge,
    query_duration: ColumnFormat.Duration,
    readable_query: ColumnFormat.Code,
    query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 200, hide_query_comment: true },
    ],
    event_time: ColumnFormat.RelatedTime,
    readable_read_rows: ColumnFormat.BackgroundBar,
    readable_written_rows: ColumnFormat.BackgroundBar,
    readable_memory_usage: ColumnFormat.BackgroundBar,
  },
  defaultParams: {
    query_id: '',
  },
}

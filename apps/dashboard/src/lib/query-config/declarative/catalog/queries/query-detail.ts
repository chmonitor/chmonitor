import type { DeclarativeQueryConfig } from '../../schema'

// baseSelect copied verbatim from the legacy queries/query-detail.ts so the
// resolved SQL strings are byte-identical (verified by the snapshot test).
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

export const queryDetailDeclarative: DeclarativeQueryConfig = {
  name: 'query-detail',
  optional: false,
  defaultView: 'auto',
  card: { primary: 'query', badges: ['type', 'query_kind'] },
  description: 'Detailed information about a specific query execution',
  // Inlined from table-notes QUERY_LOG (docs is now a plain string)
  docs: `The required table 'query_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#query-log and https://clickhouse.com/docs/en/operations/system-tables/query_log to ensure the necessary table is available.`,
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
    type: 'colored-badge',
    query_kind: 'colored-badge',
    query_cache_usage: 'colored-badge',
    query_duration: 'duration',
    readable_query: 'code',
    query: ['code-dialog', { max_truncate: 200, hide_query_comment: true }],
    event_time: 'related-time',
    readable_read_rows: 'background-bar',
    readable_written_rows: 'background-bar',
    readable_memory_usage: 'background-bar',
  },
  defaultParams: {
    query_id: '',
  },
}

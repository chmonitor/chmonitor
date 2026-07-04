import type { DeclarativeQueryConfig } from '../../schema'

export const queryCacheDeclarative: DeclarativeQueryConfig = {
  name: 'query-cache',
  // system.query_cache only exists once the query cache is enabled (CH 23.5+).
  // Optional so a missing table degrades to a graceful "table missing" empty
  // state (via tableCheck) instead of a hard SQL error.
  optional: true,
  defaultView: 'auto',
  description:
    'Entries currently held in the ClickHouse query result cache — the cached SELECT, its result size, sharing/compression flags, and when each entry expires. Expand a row for the full query and its metadata.',
  card: { primary: 'query', badges: ['stale', 'shared', 'compressed'] },
  suggestion: `Enable query cache with these settings:

SET enable_query_result_cache = 1;
SET query_cache_max_size_in_bytes = 1073741824;
SET query_cache_min_query_duration_ms = 1000;

Learn more:
https://clickhouse.com/docs/en/operations/query-cache`,
  // Inlined from table-notes QUERY_CACHE (docs is now a plain string)
  docs: `The required table 'query_cache' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/query-cache to ensure the necessary table is available.`,
  tableCheck: 'system.query_cache',
  sql: `
      SELECT
          query,
          result_size,
          formatReadableSize(result_size) AS readable_result_size,
          round(100 * result_size / nullIf(max(result_size) OVER (), 0)) AS pct_result_size,
          stale,
          shared,
          compressed,
          if(stale, 'Yes', 'No') AS readable_stale,
          if(shared, 'Yes', 'No') AS readable_shared,
          if(compressed, 'Yes', 'No') AS readable_compressed,
          expires_at,
          (expires_at - now()) AS expires_in,
          key_hash
      FROM system.query_cache
      ORDER BY expires_at DESC
      LIMIT 1000
    `,
  columns: [
    'query',
    'readable_result_size',
    'stale',
    'shared',
    'compressed',
    'expires_at',
    'expires_in',
  ],
  columnFormats: {
    query: ['code-dialog', { max_truncate: 100, hide_query_comment: true }],
    readable_result_size: 'background-bar',
    stale: 'boolean',
    shared: 'boolean',
    compressed: 'boolean',
    expires_in: 'duration',
  },
  columnDescriptions: {
    query: 'The SELECT statement whose result is stored in the query cache.',
    readable_result_size: 'Size of the cached result set held in memory.',
    stale: 'Whether the entry has passed its expiry and is awaiting refresh.',
    shared: 'Whether the entry is shared across users rather than private.',
    compressed: 'Whether the cached result is stored compressed.',
    expires_at: 'Absolute time at which the entry becomes stale.',
    expires_in: 'Time remaining until the entry becomes stale.',
  },
  // The active TS config (queries/query-cache.ts) renders a rich createExpandedPanel
  // (result-size bar + metadata grid + full query code block). The declarative
  // schema can only serialize the `config-details` auto-grid today (the richer
  // "panel" variant is a documented follow-up in schema.ts). This keeps the flip
  // to CHM_CONFIG_SOURCE=declarative from silently dropping row expansion.
  expandable: {
    type: 'config-details',
    primaryColumns: [
      'query',
      'readable_result_size',
      'stale',
      'shared',
      'compressed',
      'expires_at',
      'expires_in',
    ],
  },
  relatedCharts: [
    ['query-cache', {}],
    ['query-cache-usage', {}],
  ],
}

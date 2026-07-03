import type { QueryConfig } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { QUERY_CACHE } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const queryCacheConfig: QueryConfig = {
  name: 'query-cache',
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
  docs: QUERY_CACHE,
  // system.query_cache only exists once the query cache is enabled (CH 23.5+).
  // Mark optional so a missing table degrades to a graceful "table missing"
  // empty state (via tableCheck) instead of a hard SQL error.
  optional: true,
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
    query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 100, hide_query_comment: true },
    ],
    readable_result_size: ColumnFormat.BackgroundBar,
    stale: ColumnFormat.Boolean,
    shared: ColumnFormat.Boolean,
    compressed: ColumnFormat.Boolean,
    expires_in: ColumnFormat.Duration,
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
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        {
          type: 'bars',
          title: 'Result size',
          columns: [
            {
              key: 'result_size',
              label: 'Result size',
              readableKey: 'readable_result_size',
              pctKey: 'pct_result_size',
            },
          ],
        },
        {
          type: 'fields',
          title: 'Cache metadata',
          columns: [
            { key: 'stale', label: 'Stale' },
            { key: 'shared', label: 'Shared' },
            { key: 'compressed', label: 'Compressed' },
            { key: 'expires_at', label: 'Expires at' },
            { key: 'key_hash', label: 'Key hash' },
          ],
        },
        { type: 'code', title: 'Cached query', column: 'query' },
      ],
    }),
  },
  relatedCharts: [
    ['query-cache', {}],
    ['query-cache-usage', {}],
  ],
}

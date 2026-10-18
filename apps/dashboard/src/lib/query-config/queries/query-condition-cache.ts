import type { QueryConfig } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { ColumnFormat } from '@/types/column-format'

/**
 * system.query_condition_cache — added in ClickHouse 25.3
 *
 * Stores cached query conditions (WHERE-clause analysis results) so that
 * repeated queries with the same filters skip redundant planning work.
 * The table is empty until the optimizer has seen enough repeated queries.
 *
 * Schema reference: https://clickhouse.com/docs/en/operations/system-tables/query_condition_cache
 */
export const queryConditionCacheConfig: QueryConfig = {
  name: 'query-condition-cache',
  description:
    'Cached query conditions from system.query_condition_cache (ClickHouse 25.3+)',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_condition_cache',
  // Optional: only available on ClickHouse 25.3+
  optional: true,
  tableCheck: 'system.query_condition_cache',
  defaultView: 'auto',
  card: {
    primary: 'key_hash',
    badges: ['readable_entry_size'],
    metrics: ['entry_size'],
  },
  sql: `
      SELECT
          toString(key_hash) AS key_hash,
          entry_size,
          formatReadableSize(entry_size) AS readable_entry_size,
          round(entry_size * 100.0 / nullIf(max(entry_size) OVER (), 0), 2) AS pct_entry_size,
          matching_marks
      FROM system.query_condition_cache
      ORDER BY entry_size DESC
      LIMIT 1000
    `,
  columns: ['key_hash', 'readable_entry_size', 'matching_marks'],
  columnFormats: {
    readable_entry_size: ColumnFormat.BackgroundBar,
    matching_marks: [ColumnFormat.CodeDialog, { max_truncate: 120 }],
  },
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        {
          type: 'fields',
          title: 'Cache Entry',
          columns: [
            { key: 'key_hash', label: 'Key (hash)' },
            { key: 'readable_entry_size', label: 'Entry size' },
          ],
        },
        { type: 'code', title: 'Matching marks', column: 'matching_marks' },
      ],
    }),
  },
  relatedCharts: [['query-cache', {}]],
}

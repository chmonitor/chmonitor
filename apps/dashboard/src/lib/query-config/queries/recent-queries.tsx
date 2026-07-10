import { ClockIcon, DatabaseIcon, LayersIcon, UserIcon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'

import { RecentQueryExpandedDetails } from '@/components/data-table/cells/recent-query-expanded-details'
import { FILTER_PLACEHOLDER } from '@/lib/filters/where-builder'
import { queryInsightsFilterSchema } from '@/lib/query-config/queries/query-insights-filters'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Recent Queries: a reverse-chronological, NOT pattern-aggregated view of
 * `system.query_log` — the per-execution counterpart to Slow Query Patterns
 * (#2261, which groups by `normalized_query_hash`). Part of the Query
 * Insights epic (#2262); shares {@link queryInsightsFilterSchema} with
 * Slow Query Patterns and the forthcoming overview grid (#2260) so the same
 * time/user/query-kind/database/client filters behave identically everywhere.
 *
 * Deliberately a separate, lean config rather than reusing
 * `history-queries.ts`: History Queries already serves general-purpose log
 * browsing with a much richer, differently-shaped filter set (excluded
 * users, query text search, per-column numeric ranges, tables, client
 * agent…) that predates this epic. Retrofitting it to the shared 5-field
 * Query Insights schema would strip filters existing users rely on. All
 * `system.query_log` columns referenced here have existed since ClickHouse
 * 19.x, so — unlike `history-queries.ts` — no version-gated `sql` variants
 * are needed.
 */
export const recentQueriesConfig: QueryConfig = {
  name: 'recent-queries',
  description:
    'Reverse-chronological log of individual query executions — the per-query drill-down alongside Slow Query Patterns',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  filterSchema: queryInsightsFilterSchema,
  sql: `
    SELECT
        query_id,
        event_time,
        query_kind,
        query,
        query_duration_ms / 1000 AS query_duration,
        read_rows,
        formatReadableQuantity(read_rows) AS readable_read_rows,
        round(read_rows * 100.0 / nullIf(max(read_rows) OVER (), 0), 2) AS pct_read_rows,
        read_bytes,
        formatReadableSize(read_bytes) AS readable_read_bytes,
        round(read_bytes * 100.0 / nullIf(max(read_bytes) OVER (), 0), 2) AS pct_read_bytes,
        result_rows,
        formatReadableQuantity(result_rows) AS readable_result_rows,
        round(result_rows * 100.0 / nullIf(max(result_rows) OVER (), 0), 2) AS pct_result_rows,
        current_database AS database,
        user,
        memory_usage,
        formatReadableSize(memory_usage) AS readable_memory_usage,
        round(memory_usage * 100.0 / nullIf(max(memory_usage) OVER (), 0), 2) AS pct_memory_usage,
        client_name,
        exception_code,
        exception
    FROM (
      SELECT * FROM system.query_log
      WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
    ) AS q
    ${FILTER_PLACEHOLDER}
    ORDER BY event_time DESC
    LIMIT 250
  `,
  rowClassName: (row) => {
    if (Number(row.exception_code || 0) !== 0) {
      return 'bg-red-50 dark:bg-red-950/20'
    }
    return undefined
  },
  columns: [
    'action',
    'event_time',
    'query_kind',
    'query',
    'query_duration',
    'readable_read_rows',
    'database',
    'user',
    'readable_read_bytes',
    'readable_result_rows',
    'readable_memory_usage',
    'client_name',
  ],
  columnIcons: {
    event_time: ClockIcon,
    query_kind: LayersIcon,
    database: DatabaseIcon,
    user: UserIcon,
  },
  columnSizing: {
    action: { size: 64, minSize: 56, maxSize: 72 },
    event_time: { size: 180, minSize: 150, maxSize: 220 },
    query_kind: { size: 120, minSize: 100, maxSize: 160 },
    query: { size: 360, minSize: 240, maxSize: 520 },
    // Header label "query_duration" (14 chars) + sort caret + info icon needs
    // more room than the old 110px, which clipped it to "query_durat…".
    query_duration: { size: 132, minSize: 120, maxSize: 160 },
    database: { size: 140, minSize: 100, maxSize: 200 },
    user: { size: 104, minSize: 88, maxSize: 140 },
    // The metric columns below had no explicit sizing and fell back to the
    // content-width estimator, which sizes to the (short) formatted values and
    // clips the longer snake_case header labels (e.g. "result_rows",
    // "memory_usage"). Give each enough room for its header plus the info-icon
    // + sort-caret chrome.
    readable_read_rows: { size: 132, minSize: 116, maxSize: 180 },
    readable_read_bytes: { size: 132, minSize: 116, maxSize: 180 },
    readable_result_rows: { size: 138, minSize: 122, maxSize: 190 },
    readable_memory_usage: { size: 150, minSize: 132, maxSize: 210 },
    client_name: { size: 132, minSize: 112, maxSize: 200 },
  },
  columnFormats: {
    action: [
      ColumnFormat.Action,
      ['explain-query', 'analyze-with-ai', 'open-in-explorer'],
    ],
    event_time: ColumnFormat.RelatedTime,
    query_kind: ColumnFormat.ColoredBadge,
    query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 100, hide_query_comment: true },
    ],
    query_duration: ColumnFormat.Duration,
    readable_read_rows: ColumnFormat.BackgroundBar,
    readable_read_bytes: ColumnFormat.BackgroundBar,
    readable_result_rows: ColumnFormat.BackgroundBar,
    readable_memory_usage: ColumnFormat.BackgroundBar,
    database: ColumnFormat.Badge,
    user: ColumnFormat.ColoredBadge,
  },
  columnDescriptions: {
    event_time: 'When the query executed',
    query_duration: 'Wall-clock execution time (seconds)',
    readable_read_rows: 'Rows read from disk/memory while executing',
    readable_read_bytes: 'Bytes read from disk/memory while executing',
    readable_result_rows: 'Rows returned to the client',
    readable_memory_usage: 'Peak memory used by the query',
  },
  /**
   * Click-to-expand inline detail panel below each row. The collapsed row
   * truncates the SQL and hides several fields; the panel surfaces the full
   * syntax-highlighted query, identity/runtime metrics, and — for failed rows
   * — the full exception message.
   */
  expandable: {
    renderExpanded: (row) => <RecentQueryExpandedDetails row={row} />,
  },
  relatedCharts: [
    ['query-count', {}],
    ['query-duration', {}],
    ['query-memory', {}],
  ],
}

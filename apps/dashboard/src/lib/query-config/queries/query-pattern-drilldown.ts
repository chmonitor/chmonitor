import type { FilterSchema } from '@/lib/filters/types'
import type { QueryConfig } from '@/types/query-config'

import { FILTER_PLACEHOLDER } from '@/lib/filters/where-builder'
import { eventTimeFilterField } from '@/lib/query-config/queries/query-insights-filters'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Filter schema for the pattern detail flyout (#2262). Reuses the shared
 * `event_time` field from {@link queryInsightsFilterSchema} — the flyout
 * forwards the host page's active `event_time` URL value unchanged, so the
 * drilldown respects the same time range the aggregate stat cards (the
 * clicked row) were computed under — plus a `normalized_query_hash` field
 * used programmatically (never rendered in a `FilterBar`) to scope every
 * branch to one pattern.
 *
 * `toString(normalized_query_hash)` avoids Float64 precision loss: the filter
 * framework's `number` field type parameterizes as `Float64`, which cannot
 * represent the full UInt64 hash range losslessly. Comparing string forms
 * side-steps that entirely.
 */
const queryPatternDrilldownFilterSchema: FilterSchema = {
  fields: [
    eventTimeFilterField,
    {
      key: 'normalized_query_hash',
      column: 'toString(normalized_query_hash)',
      label: 'Pattern',
      type: 'text',
      operators: ['eq'],
    },
  ],
}

/** Columns shared by every branch of the UNION ALL below. */
const branchSelect = (reason: string) => `
      SELECT
          '${reason}' AS reason,
          query_id,
          event_time,
          query_duration_ms / 1000 AS query_duration,
          read_rows,
          formatReadableQuantity(read_rows) AS readable_read_rows,
          result_rows,
          formatReadableQuantity(result_rows) AS readable_result_rows,
          memory_usage,
          formatReadableSize(memory_usage) AS readable_memory_usage,
          exception_code,
          user,
          current_database AS database,
          client_name`

/**
 * Query-pattern drilldown: everything the pattern detail flyout (#2262) shows
 * beyond the aggregate stat cards (which come straight from the clicked
 * slow-query-patterns row — no query needed for those). One UNION ALL query,
 * one round trip, four `reason` buckets the client groups rows by:
 *
 * - `recent`: the 20 most recent executions of this pattern, newest first.
 * - `slowest` / `largest_result` / `errored`: server-ranked "notable runs" —
 *   computed with their own `ORDER BY` + `LIMIT` per branch so they reflect
 *   the true extremes across the whole filtered window, not just whatever
 *   happens to be in the most recent page (a UI that samples only "recent"
 *   rows and sorts client-side would silently miss older outliers on
 *   high-frequency patterns — exactly the patterns this flyout exists to
 *   investigate).
 *
 * Not registered in any menu or route — it's a data source for
 * `pattern-detail-sheet.tsx` via `/api/v1/tables/query-pattern-drilldown`,
 * the same mechanism `query-detail.ts` uses for its `query_id`-scoped fetch.
 */
export const queryPatternDrilldownConfig: QueryConfig = {
  name: 'query-pattern-drilldown',
  description:
    'Recent executions and notable runs (slowest, largest result, errored) for one normalized_query_hash',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  filterSchema: queryPatternDrilldownFilterSchema,
  defaultParams: {
    normalized_query_hash: '',
  },
  sql: `
    WITH
      recent AS (
${branchSelect('recent')}
        FROM (
          SELECT * FROM system.query_log
          WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
        ) AS q
        ${FILTER_PLACEHOLDER}
        ORDER BY event_time DESC
        LIMIT 20
      ),
      slowest AS (
${branchSelect('slowest')}
        FROM (
          SELECT * FROM system.query_log
          WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
        ) AS q
        ${FILTER_PLACEHOLDER}
        ORDER BY query_duration_ms DESC
        LIMIT 5
      ),
      largest_result AS (
${branchSelect('largest_result')}
        FROM (
          SELECT * FROM system.query_log
          WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
        ) AS q
        ${FILTER_PLACEHOLDER}
        ORDER BY result_rows DESC
        LIMIT 5
      ),
      errored AS (
${branchSelect('errored')}
        FROM (
          SELECT * FROM system.query_log
          WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
            AND exception_code != 0
        ) AS q
        ${FILTER_PLACEHOLDER}
        ORDER BY event_time DESC
        LIMIT 5
      )
    SELECT * FROM recent
    UNION ALL SELECT * FROM slowest
    UNION ALL SELECT * FROM largest_result
    UNION ALL SELECT * FROM errored
  `,
  columns: [
    'reason',
    'query_id',
    'event_time',
    'query_duration',
    'readable_read_rows',
    'readable_result_rows',
    'readable_memory_usage',
    'exception_code',
    'user',
    'database',
    'client_name',
  ],
  columnFormats: {
    event_time: ColumnFormat.RelatedTime,
    query_duration: ColumnFormat.Duration,
    user: ColumnFormat.ColoredBadge,
    database: ColumnFormat.Badge,
    query_id: [
      ColumnFormat.Link,
      {
        href: '/query?query_id=[query_id]&host=[ctx.hostId]',
        className: 'truncate max-w-48',
        title: 'Query Detail',
      },
    ],
  },
}

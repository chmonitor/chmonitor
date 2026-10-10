import {
  BotIcon,
  ClockIcon,
  HashIcon,
  MemoryStickIcon,
  SearchIcon,
  TimerIcon,
  UserIcon,
} from 'lucide-react'

import type { FilterSchema } from '@/lib/filters/types'
import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { RunningQueryExpandedDetails } from '@/components/data-table/cells/running-query-expanded-details'
import { FILTER_PLACEHOLDER } from '@/lib/filters/where-builder'
import { ColumnFormat } from '@/types/column-format'

/**
 * Schema-driven filter definition for the Running Queries page.
 *
 * Mirrors the column-header filter declarations on `runningQueriesConfig`:
 * the schema is the trusted SQL source and the column filters are UI sugar
 * that bind by `fieldKey` (or column name) into this schema.
 */
export const runningQueriesFilterSchema: FilterSchema = {
  fields: [
    {
      key: 'user',
      column: 'user',
      label: 'User',
      type: 'select',
      operators: ['in', 'notIn', 'eq', 'ne', 'contains'],
      icon: UserIcon,
      description: 'Filter by the ClickHouse user running the query.',
    },
    {
      key: 'query',
      column: 'query',
      label: 'Query text',
      type: 'text',
      operators: ['contains', 'notContains', 'eq'],
      icon: SearchIcon,
      placeholder: 'e.g. SELECT * FROM ...',
      description: 'Full-text search inside the running query body.',
    },
    {
      key: 'query_id',
      column: 'query_id',
      label: 'Query ID',
      type: 'text',
      operators: ['eq', 'contains'],
      icon: HashIcon,
      placeholder: 'e.g. 8f3a1c2e-...',
    },
    {
      key: 'elapsed',
      column: 'elapsed',
      label: 'Elapsed',
      type: 'number',
      operators: ['gte', 'gt', 'lte', 'lt', 'between'],
      icon: TimerIcon,
      unit: 's',
      placeholder: 'seconds',
      description: 'How long the query has been running, in seconds.',
    },
    {
      key: 'memory',
      column: 'memory_usage',
      label: 'Memory',
      type: 'number',
      operators: ['gte', 'gt', 'lte', 'lt', 'between'],
      icon: MemoryStickIcon,
      unit: 'MB',
      scale: 1024 * 1024,
      placeholder: 'megabytes',
    },
    {
      key: 'client_agent',
      column: 'client_agent',
      label: 'Client agent',
      type: 'select',
      operators: ['in', 'contains', 'eq', 'ne'],
      icon: BotIcon,
      description: 'AI coding agent that issued the query (CH 26.6+).',
      since: '26.6',
    },
  ],
  presets: [
    {
      name: 'Slow (> 5s)',
      icon: ClockIcon,
      filters: [{ key: 'elapsed', operator: 'gte', value: '5' }],
    },
    {
      name: 'Heavy memory (> 1GB)',
      icon: MemoryStickIcon,
      filters: [{ key: 'memory', operator: 'gte', value: '1024' }],
    },
  ],
}

/**
 * Running queries from `system.processes`.
 *
 * Every field the card / summary formatter reads is selected here — earlier
 * revisions silently dropped `ProfileEvents`, `pct_progress` and the thread
 * count, which is why CPU rendered "0s" and the progress bar stuck at 0%.
 *
 * Version compatibility: this SELECT uses only columns and functions that are
 * stable across ClickHouse v24.x → v26.x. The peak-threads metric is derived
 * from `length(thread_ids)` rather than `system.processes.peak_threads_usage`
 * because that column does not exist before ~25.1 (absent in 24.5–24.12 per
 * `docs/clickhouse-schemas/tables/processes.md`); `thread_ids` is universal.
 */
export const runningQueriesConfig: QueryConfig = {
  name: 'running-queries',
  refreshInterval: 5_000,
  // `is_cancelled = 0` is applied in an inner subquery so the dynamic
  // FILTER_PLACEHOLDER WHERE clause (which always starts with `WHERE`) can be
  // injected at the outer level without colliding with the static condition.
  // We alias the inner query (`q`) and use `q.*` rather than a bare `SELECT *`
  // because the latter is explicitly disallowed for this frequently-refreshed
  // path by `lib/__tests__/versioned-sql.test.ts`.
  sql: [
    {
      since: '23.8',
      description: 'Base running queries query',
      sql: `
    ${QUERY_COMMENT}
    SELECT q.* FROM (
      SELECT
        query_id,
        query,
        query_kind,
        user,
        os_user,
        current_database,
        initial_query_id,
        is_initial_query,
        address,
        port,
        interface,
        client_name,
        client_hostname,
        distributed_depth,
        elapsed,
        read_rows,
        read_bytes,
        total_rows_approx,
        written_rows,
        written_bytes,
        memory_usage,
        peak_memory_usage,
        ProfileEvents,
        length(thread_ids) AS thread_count,
        query_id AS action,
        multiIf (elapsed < 30, format('{} seconds', round(elapsed, 1)),
                 elapsed < 90, 'a minute',
                 formatReadableTimeDelta(elapsed, 'days', 'minutes')) AS readable_elapsed,
        formatReadableQuantity(read_rows) AS readable_read_rows,
        formatReadableSize(read_bytes) AS readable_read_bytes,
        formatReadableQuantity(written_rows) AS readable_written_rows,
        formatReadableSize(written_bytes) AS readable_written_bytes,
        formatReadableQuantity(total_rows_approx) AS readable_total_rows_approx,
        formatReadableSize(peak_memory_usage) AS readable_peak_memory_usage,
        multiIf (
          memory_usage = 0, formatReadableSize(memory_usage),
          formatReadableSize(memory_usage) = formatReadableSize(peak_memory_usage), formatReadableSize(memory_usage),
          formatReadableSize(memory_usage) || ' (peak ' || readable_peak_memory_usage || ')'
        ) AS readable_memory_usage,
        if(total_rows_approx > 0 AND query_kind = 'Select', toString(round((100 * read_rows) / total_rows_approx, 2)) || '%', '') AS progress,
        if(total_rows_approx > 0 AND query_kind = 'Select', least(100., round((100 * read_rows) / total_rows_approx, 1)), 0.) AS pct_progress,
        if(total_rows_approx > 0 AND read_rows > 0 AND read_rows < total_rows_approx AND query_kind = 'Select',
           round(elapsed * (total_rows_approx - read_rows) / read_rows, 1), NULL) AS estimated_remaining_time,
        formatReadableQuantity(ProfileEvents['Merge']) AS launched_merges,
        multiIf(interface = 1, 'TCP',
                interface = 2, 'HTTP',
                interface = 3, 'gRPC',
                interface = 4, 'MySQL',
                interface = 5, 'PostgreSQL',
                interface = 6, 'Local',
                interface = 7, 'Interserver',
                toString(interface)) AS interface_label
      FROM system.processes
      WHERE is_cancelled = 0
    ) AS q
    ${FILTER_PLACEHOLDER}
    ORDER BY elapsed DESC
  `,
    },
    {
      since: '26.6',
      description: 'Added client_agent column from system.processes (CH 26.6+)',
      sql: `
    ${QUERY_COMMENT}
    SELECT q.* FROM (
      SELECT
        query_id,
        query,
        query_kind,
        user,
        os_user,
        current_database,
        initial_query_id,
        is_initial_query,
        address,
        port,
        interface,
        client_name,
        client_hostname,
        client_agent,
        distributed_depth,
        elapsed,
        read_rows,
        read_bytes,
        total_rows_approx,
        written_rows,
        written_bytes,
        memory_usage,
        peak_memory_usage,
        ProfileEvents,
        length(thread_ids) AS thread_count,
        query_id AS action,
        multiIf (elapsed < 30, format('{} seconds', round(elapsed, 1)),
                 elapsed < 90, 'a minute',
                 formatReadableTimeDelta(elapsed, 'days', 'minutes')) AS readable_elapsed,
        formatReadableQuantity(read_rows) AS readable_read_rows,
        formatReadableSize(read_bytes) AS readable_read_bytes,
        formatReadableQuantity(written_rows) AS readable_written_rows,
        formatReadableSize(written_bytes) AS readable_written_bytes,
        formatReadableQuantity(total_rows_approx) AS readable_total_rows_approx,
        formatReadableSize(peak_memory_usage) AS readable_peak_memory_usage,
        multiIf (
          memory_usage = 0, formatReadableSize(memory_usage),
          formatReadableSize(memory_usage) = formatReadableSize(peak_memory_usage), formatReadableSize(memory_usage),
          formatReadableSize(memory_usage) || ' (peak ' || readable_peak_memory_usage || ')'
        ) AS readable_memory_usage,
        if(total_rows_approx > 0 AND query_kind = 'Select', toString(round((100 * read_rows) / total_rows_approx, 2)) || '%', '') AS progress,
        if(total_rows_approx > 0 AND query_kind = 'Select', least(100., round((100 * read_rows) / total_rows_approx, 1)), 0.) AS pct_progress,
        if(total_rows_approx > 0 AND read_rows > 0 AND read_rows < total_rows_approx AND query_kind = 'Select',
           round(elapsed * (total_rows_approx - read_rows) / read_rows, 1), NULL) AS estimated_remaining_time,
        formatReadableQuantity(ProfileEvents['Merge']) AS launched_merges,
        multiIf(interface = 1, 'TCP',
                interface = 2, 'HTTP',
                interface = 3, 'gRPC',
                interface = 4, 'MySQL',
                interface = 5, 'PostgreSQL',
                interface = 6, 'Local',
                interface = 7, 'Interserver',
                toString(interface)) AS interface_label
      FROM system.processes
      WHERE is_cancelled = 0
    ) AS q
    ${FILTER_PLACEHOLDER}
    ORDER BY elapsed DESC
  `,
    },
  ] as VersionedSql[],
  columns: ['action', 'query', 'client_agent'],
  rowClassName: (row) => {
    // elapsed is in seconds for running queries
    const elapsed = Number(row.elapsed || 0)
    if (elapsed > 30) return 'bg-red-50 dark:bg-red-950/20'
    if (elapsed > 5) return 'bg-amber-50 dark:bg-amber-950/20'
    return undefined
  },

  // Bulk actions for selected rows (shown in toolbar)
  bulkActions: ['kill-query'],
  columnFormats: {
    action: [
      ColumnFormat.InlineAction,
      ['kill-query', 'analyze-with-ai', 'open-in-explorer'],
    ],
    query: ColumnFormat.RunningQuerySummary,
    client_agent: ColumnFormat.ColoredBadge,
  },

  /**
   * Click-to-expand inline detail panel below each row. Renders identity,
   * runtime metrics and a formatted ProfileEvents grid for the selected query.
   */
  expandable: {
    renderExpanded: (row) => <RunningQueryExpandedDetails row={row} />,
  },

  /**
   * Per-column header filters. Only the `query` column is visible in this
   * table, so only that filter shows up in a column header; `user` and
   * `elapsed` are accessible from the auto-rendered filter bar above the
   * table (driven by `filterSchema` below).
   */
  columnFilters: {
    user: { type: 'multi-select' },
    query: { type: 'text', placeholder: 'SELECT ...' },
    elapsed: { type: 'numeric', fieldKey: 'elapsed' },
  },

  filterSchema: runningQueriesFilterSchema,

  relatedCharts: [
    [
      'query-count',
      {
        title: 'Running Queries',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
        colSpan: 7,
      },
    ],
    [
      'summary-used-by-running-queries',
      {
        title: 'Running Queries Summary',
        colSpan: 3,
      },
    ],
    [
      'query-count-by-user',
      {
        title: 'Queries by User',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
        showLegend: false,
        colSpan: 7,
      },
    ],
    [
      'summary-used-by-merges',
      {
        title: 'Merge Summary',
        colSpan: 3,
      },
    ],
  ],
}

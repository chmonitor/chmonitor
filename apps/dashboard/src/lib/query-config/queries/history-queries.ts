import {
  ActivityIcon,
  BotIcon,
  ClockIcon,
  DatabaseIcon,
  FileOutputIcon,
  HashIcon,
  LayersIcon,
  MemoryStickIcon,
  MonitorIcon,
  SearchIcon,
  TableIcon,
  TimerIcon,
  UserIcon,
  UserXIcon,
  ZapIcon,
} from 'lucide-react'

import type { FilterSchema } from '@/lib/filters/types'
import type { QueryConfig } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { FILTER_PLACEHOLDER } from '@/lib/filters/where-builder'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Query tail shared by every version variant. The {@link FILTER_PLACEHOLDER}
 * marker is replaced server-side with a parameterized `WHERE` clause built
 * from the {@link historyQueryFilterSchema}.
 */
const historyQueryTail = `
          FROM system.query_log
          ${FILTER_PLACEHOLDER}
          ORDER BY event_time DESC
          LIMIT 250`

/** Service users excluded from the result by default (configurable per deploy). */
const defaultExcludedUsers = process.env.CLICKHOUSE_EXCLUDE_USER_DEFAULT || ''

const queryLogDynamicOptions = (column: string) => ({
  table: 'system.query_log',
  column,
  where: 'event_time > now() - toIntervalDay(7)',
})

/**
 * Schema-driven filter definition for the History Queries page.
 *
 * Each field declares the column it targets, the operators it supports, and
 * how its value editor should render. The server validates active filters
 * against this schema before building the SQL `WHERE` clause.
 */
export const historyQueryFilterSchema: FilterSchema = {
  fields: [
    {
      key: 'event_time',
      column: 'event_time',
      label: 'Time',
      type: 'datetime',
      operators: ['withinHours', 'between', 'gte', 'lte'],
      icon: ClockIcon,
      options: [
        { label: 'Last 1 hour', value: '1' },
        { label: 'Last 6 hours', value: '6' },
        { label: 'Last 24 hours', value: '24' },
        { label: 'Last 7 days', value: '168' },
        { label: 'Last 30 days', value: '720' },
      ],
      description: 'Relative window or an explicit date range.',
    },
    {
      key: 'user',
      column: 'user',
      label: 'User',
      type: 'select',
      operators: ['in', 'notIn', 'eq', 'ne', 'contains'],
      dynamicOptions: queryLogDynamicOptions('user'),
      icon: UserIcon,
      description: 'Pick from recent users or search by name.',
    },
    {
      key: 'excluded_users',
      column: 'user',
      label: 'Exclude users',
      type: 'select',
      operators: ['notIn'],
      dynamicOptions: queryLogDynamicOptions('user'),
      icon: UserXIcon,
      defaultValue: defaultExcludedUsers
        ? { operator: 'notIn', value: defaultExcludedUsers }
        : undefined,
    },
    {
      key: 'query',
      column: 'query',
      label: 'Query text',
      type: 'text',
      operators: ['contains', 'notContains', 'eq'],
      icon: SearchIcon,
      placeholder: 'e.g. SELECT * FROM ...',
      description: 'Full-text search inside the query body.',
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
      key: 'query_kind',
      column: 'query_kind',
      label: 'Query kind',
      type: 'select',
      operators: ['in', 'eq', 'ne'],
      icon: LayersIcon,
      options: [
        { label: 'Select', value: 'Select' },
        { label: 'Insert', value: 'Insert' },
        { label: 'Create', value: 'Create' },
        { label: 'Alter', value: 'Alter' },
        { label: 'Drop', value: 'Drop' },
        { label: 'Rename', value: 'Rename' },
        { label: 'Optimize', value: 'Optimize' },
        { label: 'System', value: 'System' },
        { label: 'Show', value: 'Show' },
        { label: 'Set', value: 'Set' },
        { label: 'Backup', value: 'Backup' },
      ],
    },
    {
      key: 'type',
      column: 'type',
      label: 'Status',
      type: 'select',
      operators: ['in', 'eq', 'ne'],
      icon: ActivityIcon,
      options: [
        { label: 'Query started', value: 'QueryStart' },
        { label: 'Query finished', value: 'QueryFinish' },
        { label: 'Failed before start', value: 'ExceptionBeforeStart' },
        { label: 'Failed while running', value: 'ExceptionWhileProcessing' },
      ],
    },
    {
      key: 'duration',
      column: 'query_duration_ms',
      label: 'Duration',
      type: 'number',
      operators: ['gte', 'gt', 'lte', 'lt', 'between'],
      icon: TimerIcon,
      unit: 's',
      scale: 1000,
      placeholder: 'seconds',
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
      key: 'read_rows',
      column: 'read_rows',
      label: 'Read rows',
      type: 'number',
      operators: ['gte', 'gt', 'lte', 'lt', 'between'],
      icon: DatabaseIcon,
      unit: 'rows',
    },
    {
      key: 'written_rows',
      column: 'written_rows',
      label: 'Written rows',
      type: 'number',
      operators: ['gte', 'gt', 'lte', 'lt'],
      icon: DatabaseIcon,
      unit: 'rows',
    },
    {
      key: 'result_rows',
      column: 'result_rows',
      label: 'Result rows',
      type: 'number',
      operators: ['gte', 'gt', 'lte', 'lt'],
      icon: FileOutputIcon,
      unit: 'rows',
    },
    {
      key: 'tables',
      column: "arrayStringConcat(tables, ', ')",
      label: 'Table',
      type: 'text',
      operators: ['contains'],
      icon: TableIcon,
      placeholder: 'e.g. default.events',
      description: 'Matches any table the query touched.',
    },
    {
      key: 'client_name',
      column: 'client_name',
      label: 'Client',
      type: 'select',
      operators: ['in', 'contains', 'eq'],
      dynamicOptions: queryLogDynamicOptions('client_name'),
      icon: MonitorIcon,
    },
    {
      key: 'client_agent',
      column: 'client_agent',
      label: 'Client agent',
      type: 'select',
      operators: ['in', 'contains', 'eq', 'ne'],
      dynamicOptions: queryLogDynamicOptions('client_agent'),
      icon: BotIcon,
      description: 'AI coding agent that issued the query (CH 26.6+).',
    },
  ],
  presets: [
    {
      name: 'Last hour',
      icon: ClockIcon,
      filters: [{ key: 'event_time', operator: 'withinHours', value: '1' }],
    },
    {
      name: 'Slow queries (> 10s)',
      icon: TimerIcon,
      filters: [{ key: 'duration', operator: 'gte', value: '10' }],
    },
    {
      name: 'Failed queries',
      icon: ZapIcon,
      filters: [
        {
          key: 'type',
          operator: 'in',
          value: 'ExceptionBeforeStart,ExceptionWhileProcessing',
        },
      ],
    },
    {
      name: 'Heavy memory (> 1GB)',
      icon: MemoryStickIcon,
      filters: [{ key: 'memory', operator: 'gte', value: '1024' }],
    },
    {
      name: 'Inserts only',
      icon: DatabaseIcon,
      filters: [{ key: 'query_kind', operator: 'in', value: 'Insert' }],
    },
    {
      name: 'Selects only',
      icon: SearchIcon,
      filters: [{ key: 'query_kind', operator: 'in', value: 'Select' }],
    },
  ],
  quickFilters: [
    {
      key: 'query_kind',
      display: 'segmented',
      label: 'Type',
      icon: LayersIcon,
      options: [
        { label: 'Select', value: 'Select' },
        { label: 'Insert', value: 'Insert' },
        { label: 'Create', value: 'Create' },
        { label: 'Alter', value: 'Alter' },
        { label: 'Drop', value: 'Drop' },
      ],
      includeAll: true,
    },
  ],
}

export const historyQueriesConfig: QueryConfig = {
  name: 'history-queries',
  clickhouseSettings: {
    max_result_rows: '250',
  },
  // Cards on phones (the wide query_log table is unreadable in a scroll box),
  // table on desktop — with a toggle so either view is reachable anywhere.
  defaultView: 'auto',
  // Importance ranking for the card view: the SQL is the hero, kind/status are
  // header badges, the live scalars form the metric chip row, and the rest
  // (memory / read-rows mini-bars, query_id, client) stay as detail rows.
  card: {
    primary: 'query',
    badges: ['query_kind', 'type'],
    metrics: ['user', 'query_duration', 'event_time'],
    hidden: [
      'readable_written_rows',
      'readable_result_rows',
      'query_cache_usage',
    ],
  },
  columnIcons: {
    user: UserIcon,
    query_duration: TimerIcon,
    event_time: ClockIcon,
  },
  // Rich expand panel (declarative): headline outcome tiles, relative-row
  // mini-bars, an identity grid, then the full query as a code block. Renders
  // identically in the table (full-width row) and card (inline) views.
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        {
          type: 'stats',
          columns: [
            {
              key: 'result_rows',
              label: 'Result rows',
              readableKey: 'readable_result_rows',
            },
            {
              key: 'memory_usage',
              label: 'Memory',
              readableKey: 'readable_memory_usage',
            },
          ],
        },
        {
          type: 'bars',
          title: 'Rows scanned (relative to result set)',
          columns: [
            {
              key: 'read_rows',
              label: 'Read rows',
              readableKey: 'readable_read_rows',
              pctKey: 'pct_read_rows',
            },
            {
              key: 'written_rows',
              label: 'Written rows',
              readableKey: 'readable_written_rows',
              pctKey: 'pct_written_rows',
            },
          ],
        },
        {
          type: 'fields',
          title: 'Identity',
          columns: [
            'query_id',
            'user',
            'client_name',
            'client_agent',
            'query_kind',
            'type',
            'event_time',
          ],
        },
        { type: 'code', title: 'Full query', column: 'query' },
      ],
    }),
  },
  description:
    'Contains information about executed queries: start time, duration of processing, error messages',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: [
    {
      since: '23.8',
      description: 'Base query without query_cache_usage',
      sql: `
          SELECT
              type,
              query_id,
              query_duration_ms,
              query_duration_ms / 1000 as query_duration,
              event_time,
              query,
              user,
              read_rows,
              formatReadableQuantity(read_rows) AS readable_read_rows,
              round(100 * read_rows / MAX(read_rows) OVER ()) AS pct_read_rows,
              written_rows,
              formatReadableQuantity(written_rows) AS readable_written_rows,
              round(100 * written_rows / MAX(written_rows) OVER ()) AS pct_written_rows,
              result_rows,
              formatReadableQuantity(result_rows) AS readable_result_rows,
              memory_usage,
              formatReadableSize(memory_usage) AS readable_memory_usage,
              round(100 * memory_usage / MAX(memory_usage) OVER ()) AS pct_memory_usage,
              query_kind,
              client_name
${historyQueryTail}
      `,
    },
    {
      since: '24.1',
      description: 'Added query_cache_usage column',
      sql: `
          SELECT
              type,
              query_id,
              query_duration_ms,
              query_duration_ms / 1000 as query_duration,
              event_time,
              query,
              user,
              read_rows,
              formatReadableQuantity(read_rows) AS readable_read_rows,
              round(100 * read_rows / MAX(read_rows) OVER ()) AS pct_read_rows,
              written_rows,
              formatReadableQuantity(written_rows) AS readable_written_rows,
              round(100 * written_rows / MAX(written_rows) OVER ()) AS pct_written_rows,
              result_rows,
              formatReadableQuantity(result_rows) AS readable_result_rows,
              memory_usage,
              formatReadableSize(memory_usage) AS readable_memory_usage,
              round(100 * memory_usage / MAX(memory_usage) OVER ()) AS pct_memory_usage,
              query_kind,
              query_cache_usage,
              client_name
${historyQueryTail}
      `,
    },
    {
      since: '26.6',
      description: 'Added client_agent column (CH 26.6+)',
      sql: `
          SELECT
              type,
              query_id,
              query_duration_ms,
              query_duration_ms / 1000 as query_duration,
              event_time,
              query,
              user,
              read_rows,
              formatReadableQuantity(read_rows) AS readable_read_rows,
              round(100 * read_rows / MAX(read_rows) OVER ()) AS pct_read_rows,
              written_rows,
              formatReadableQuantity(written_rows) AS readable_written_rows,
              round(100 * written_rows / MAX(written_rows) OVER ()) AS pct_written_rows,
              result_rows,
              formatReadableQuantity(result_rows) AS readable_result_rows,
              memory_usage,
              formatReadableSize(memory_usage) AS readable_memory_usage,
              round(100 * memory_usage / MAX(memory_usage) OVER ()) AS pct_memory_usage,
              query_kind,
              query_cache_usage,
              client_name,
              client_agent
${historyQueryTail}
      `,
    },
  ],

  columns: [
    'action',
    'user',
    'query',
    'query_id',
    'query_duration',
    'readable_memory_usage',
    'event_time',
    'readable_read_rows',
    'readable_written_rows',
    'readable_result_rows',
    'query_kind',
    'query_cache_usage',
    'type',
    'client_name',
    'client_agent',
  ],
  columnSizing: {
    action: { size: 64, minSize: 56, maxSize: 72 },
    user: { size: 104, minSize: 88, maxSize: 140 },
    query: { size: 360, minSize: 240, maxSize: 520 },
    query_id: { size: 220, minSize: 160, maxSize: 320 },
    query_duration: { size: 120, minSize: 104, maxSize: 150 },
    readable_memory_usage: { size: 160, minSize: 140, maxSize: 220 },
    event_time: { size: 180, minSize: 150, maxSize: 220 },
    query_kind: { size: 140, minSize: 120, maxSize: 180 },
    type: { size: 150, minSize: 120, maxSize: 180 },
    client_name: { size: 180, minSize: 140, maxSize: 240 },
    client_agent: { size: 180, minSize: 140, maxSize: 240 },
  },
  columnFormats: {
    action: [
      ColumnFormat.Action,
      [
        'explain-query',
        'analyze-with-ai',
        'open-in-explorer',
        'view-resource-timeline',
      ],
    ],
    user: ColumnFormat.ColoredBadge,
    type: ColumnFormat.ColoredBadge,
    query_duration: ColumnFormat.Duration,
    query_kind: ColumnFormat.ColoredBadge,
    query_cache_usage: ColumnFormat.ColoredBadge,
    // Inline preview (not a dialog trigger): a nested button would swallow the
    // row click and block inline expansion. The full SQL lives in the expanded
    // row's "Full query" code section, mirroring the running-queries detail.
    query: [
      ColumnFormat.CodeDialog,
      {
        max_truncate: 100,
        hide_query_comment: true,
        trigger_classname: '!max-w-[280px] overflow-hidden',
        inline: true,
      },
    ],
    event_time: ColumnFormat.RelatedTime,
    readable_read_rows: ColumnFormat.BackgroundBar,
    readable_written_rows: ColumnFormat.BackgroundBar,
    readable_memory_usage: ColumnFormat.BackgroundBar,
    query_id: [
      ColumnFormat.Link,
      {
        href: '/query?query_id=[query_id]&host=[ctx.hostId]',
        className: 'truncate max-w-48',
        title: 'Query Detail',
      },
    ],
    client_agent: ColumnFormat.ColoredBadge,
  },

  rowClassName: (row) => {
    const duration = Number(row.query_duration_ms || 0)
    if (duration > 30000) return 'bg-red-50 dark:bg-red-950/20'
    if (duration > 5000) return 'bg-amber-50 dark:bg-amber-950/20'
    return undefined
  },

  filterSchema: historyQueryFilterSchema,

  relatedCharts: [
    ['query-count', {}],
    ['query-duration', {}],
    ['query-duration-percentiles', {}],
    ['query-memory', {}],
    [
      'query-count-by-user',
      {
        showLegend: false,
      },
    ],
    ['top-query-fingerprints', { showLegend: false }],
    ['cancelled-queries', {}],
  ],
}

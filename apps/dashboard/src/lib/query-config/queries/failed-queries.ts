import { ClockIcon, TimerIcon, UserIcon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'

import { createExpandedPanel } from '@/components/data-table/cells/expanded-panel'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

export const failedQueriesConfig: QueryConfig = {
  name: 'failed-queries',
  // For a failed query the *exception* is the most important thing — it leads
  // the card, with type/kind as badges and identity/duration as metrics.
  defaultView: 'auto',
  card: {
    primary: 'exception',
    badges: ['type', 'query_kind'],
    metrics: ['user', 'query_start_time', 'query_duration_ms'],
    hidden: [
      'stack_trace',
      'normalized_query',
      'is_initial_query',
      'initial_user',
      'client_hostname',
    ],
  },
  columnIcons: {
    user: UserIcon,
    query_start_time: ClockIcon,
    query_duration_ms: TimerIcon,
  },
  expandable: {
    renderExpanded: createExpandedPanel({
      sections: [
        { type: 'code', title: 'Exception', column: 'exception' },
        { type: 'code', title: 'Stack trace', column: 'stack_trace' },
        {
          type: 'fields',
          title: 'Identity',
          columns: [
            'query_id',
            'user',
            'initial_user',
            'type',
            'query_kind',
            'query_start_time',
            'client',
            'databases',
            'tables',
          ],
        },
        { type: 'code', title: 'Normalized query', column: 'normalized_query' },
      ],
    }),
  },
  description: "type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  defaultParams: {
    type: '',
    last_hours: '336',
  },
  filterParamPresets: [
    {
      name: 'Exception before start',
      key: 'type',
      value: 'ExceptionBeforeStart',
    },
    {
      name: 'Exception while processing',
      key: 'type',
      value: 'ExceptionWhileProcessing',
    },
    {
      name: 'Last 1 hour',
      key: 'last_hours',
      value: '1',
    },
    {
      name: 'Last 24 hours',
      key: 'last_hours',
      value: '24',
    },
    {
      name: 'Last 7 days',
      key: 'last_hours',
      value: '168',
    },
  ],
  sql: [
    {
      since: '23.8',
      description: 'Base query without query_cache_usage',
      sql: `
        SELECT
            type,
            query_start_time,
            query_duration_ms,
            query_id,
            query_kind,
            is_initial_query,
            normalizeQuery(query) AS normalized_query,
            concat(toString(read_rows), ' rows / ', formatReadableSize(read_bytes)) AS read,
            concat(toString(written_rows), ' rows / ', formatReadableSize(written_bytes)) AS written,
            concat(toString(result_rows), ' rows / ', formatReadableSize(result_bytes)) AS result,
            formatReadableSize(memory_usage) AS memory_usage,
            exception,
            concat('\n', stack_trace) AS stack_trace,
            user,
            initial_user,
            multiIf(empty(client_name), http_user_agent, concat(client_name, ' ', toString(client_version_major), '.', toString(client_version_minor), '.', toString(client_version_patch))) AS client,
            client_hostname,
            toString(databases) AS databases,
            toString(tables) AS tables,
            toString(columns) AS columns,
            toString(used_aggregate_functions) AS used_aggregate_functions,
            toString(used_aggregate_function_combinators) AS used_aggregate_function_combinators,
            toString(used_database_engines) AS used_database_engines,
            toString(used_data_type_families) AS used_data_type_families,
            toString(used_dictionaries) AS used_dictionaries,
            toString(used_formats) AS used_formats,
            toString(used_functions) AS used_functions,
            toString(used_storages) AS used_storages,
            toString(used_table_functions) AS used_table_functions,
            toString(thread_ids) AS thread_ids
        FROM system.query_log
        -- PREWHERE reads the small type + event_time columns first and skips
        -- granules with no exceptions, so the heavy query/stack_trace/toString
        -- blobs are only read for the few rows that survive the filter.
        PREWHERE type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']
            AND ({type:String} = '' OR type = {type:String})
            AND event_time > now() - interval {last_hours:UInt64} hour
        ORDER BY query_start_time DESC
        LIMIT 1000
      `,
    },
    {
      since: '24.1',
      description: 'Added query_cache_usage column',
      sql: `
        SELECT
            type,
            query_start_time,
            query_duration_ms,
            query_id,
            query_kind,
            is_initial_query,
            query_cache_usage,
            normalizeQuery(query) AS normalized_query,
            concat(toString(read_rows), ' rows / ', formatReadableSize(read_bytes)) AS read,
            concat(toString(written_rows), ' rows / ', formatReadableSize(written_bytes)) AS written,
            concat(toString(result_rows), ' rows / ', formatReadableSize(result_bytes)) AS result,
            formatReadableSize(memory_usage) AS memory_usage,
            exception,
            concat('\n', stack_trace) AS stack_trace,
            user,
            initial_user,
            multiIf(empty(client_name), http_user_agent, concat(client_name, ' ', toString(client_version_major), '.', toString(client_version_minor), '.', toString(client_version_patch))) AS client,
            client_hostname,
            toString(databases) AS databases,
            toString(tables) AS tables,
            toString(columns) AS columns,
            toString(used_aggregate_functions) AS used_aggregate_functions,
            toString(used_aggregate_function_combinators) AS used_aggregate_function_combinators,
            toString(used_database_engines) AS used_database_engines,
            toString(used_data_type_families) AS used_data_type_families,
            toString(used_dictionaries) AS used_dictionaries,
            toString(used_formats) AS used_formats,
            toString(used_functions) AS used_functions,
            toString(used_storages) AS used_storages,
            toString(used_table_functions) AS used_table_functions,
            toString(thread_ids) AS thread_ids
        FROM system.query_log
        -- PREWHERE reads the small type + event_time columns first and skips
        -- granules with no exceptions, so the heavy query/stack_trace/toString
        -- blobs are only read for the few rows that survive the filter.
        PREWHERE type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']
            AND ({type:String} = '' OR type = {type:String})
            AND event_time > now() - interval {last_hours:UInt64} hour
        ORDER BY query_start_time DESC
        LIMIT 1000
      `,
    },
  ],
  columns: [
    'action',
    'query_id',
    'exception',
    'type',
    'query_start_time',
    'query_duration_ms',
    'query_kind',
    'is_initial_query',
    'query_cache_usage',
    'read',
    'written',
    'result',
    'memory_usage',
    'stack_trace',
    'user',
    'initial_user',
    'client',
    'client_hostname',
    'databases',
    'tables',
    'columns',
    'used_aggregate_functions',
    'used_aggregate_function_combinators',
    'used_database_engines',
    'used_data_type_families',
    'used_dictionaries',
    'used_formats',
    'used_functions',
    'used_storages',
    'used_table_functions',
    'thread_ids',
    'normalized_query',
  ],
  columnFormats: {
    action: [ColumnFormat.Action, ['explain-query', 'open-in-explorer']],
    normalized_query: [
      ColumnFormat.CodeDialog,
      {
        max_truncate: 100,
        hide_query_comment: true,
        dialog_title: 'Query',
        trigger_classname: '!max-w-[280px] overflow-hidden',
      },
    ],
    type: ColumnFormat.ColoredBadge,
    query_duration_ms: ColumnFormat.Duration,
    query_start_time: ColumnFormat.RelatedTime,
    exception: [
      ColumnFormat.CodeDialog,
      {
        max_truncate: 100,
        dialog_title: 'Exception',
        trigger_classname: '!max-w-[280px] overflow-hidden',
        // Exception payloads are often long, wide stack-ish text — give them a
        // wider dialog than the default so lines wrap less; the body still
        // scrolls (ScrollArea) when the content overflows vertically.
        dialog_classname: 'w-[min(97vw,1400px)]',
      },
    ],
    stack_trace: [
      ColumnFormat.CodeDialog,
      {
        max_truncate: 100,
        dialog_title: 'Stack Trace',
        trigger_classname: '!max-w-[280px] overflow-hidden',
        dialog_classname: 'w-[min(97vw,1400px)]',
      },
    ],
    client: ColumnFormat.CodeDialog,
    user: ColumnFormat.ColoredBadge,
    initial_user: ColumnFormat.ColoredBadge,
    is_initial_query: ColumnFormat.Boolean,
    query_kind: ColumnFormat.Badge,
    query_cache_usage: ColumnFormat.ColoredBadge,
    databases: ColumnFormat.CodeDialog,
    tables: ColumnFormat.CodeDialog,
    columns: ColumnFormat.CodeDialog,
    used_aggregate_functions: ColumnFormat.CodeDialog,
    used_aggregate_function_combinators: ColumnFormat.CodeDialog,
    used_formats: ColumnFormat.CodeDialog,
    used_dictionaries: ColumnFormat.CodeDialog,
    used_functions: ColumnFormat.CodeDialog,
    used_table_functions: ColumnFormat.CodeDialog,
    thread_ids: ColumnFormat.CodeDialog,
    query_id: [
      ColumnFormat.Link,
      {
        href: '/query?query_id=[query_id]&host=[ctx.hostId]',
        className: 'truncate max-w-48 text-wrap',
        title: 'Query Detail',
      },
    ],
  },
  relatedCharts: [
    [
      'failed-query-count',
      {
        title: 'Failed Queries (Exception Types)',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
        showLegend: false,
      },
    ],
    'break',
    [
      'failed-query-count-by-user',
      {
        title: 'Failed Queries by Users',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
        showLegend: false,
      },
    ],
  ],
}

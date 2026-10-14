import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const stackTracesConfig: QueryConfig = {
  name: 'stack-traces',
  description: 'Current stack traces for all server threads',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/stack_trace',
  sql: `
    SELECT
      thread_name,
      thread_id,
      query_id,
      arrayStringConcat(
        arrayMap(x -> demangle(addressToSymbol(x)), trace),
        '\\n'
      ) as stack_trace
    FROM system.stack_trace
    ORDER BY thread_name
  `,
  clickhouseSettings: {
    allow_introspection_functions: 1,
  },
  columns: ['thread_name', 'thread_id', 'query_id', 'stack_trace'],
  columnFormats: {
    thread_name: ColumnFormat.ColoredBadge,
    thread_id: ColumnFormat.Number,
    query_id: [
      ColumnFormat.Link,
      {
        href: '/query?query_id=[query_id]&host=[ctx.hostId]',
        className: 'max-w-24 truncate',
      },
    ],
    stack_trace: [
      ColumnFormat.CodeDialog,
      { max_truncate: 50, dialog_title: 'Stack Trace' },
    ],
  },
}

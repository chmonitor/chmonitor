import type { QueryConfig } from '@/types/query-config'

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { ColumnFormat } from '@/types/column-format'

/**
 * Keeper changelog (WAL) files — Raft write-ahead log metadata.
 * Requires ClickHouse 26.6+ with Keeper co-located on this node.
 */
export const keeperChangelogsConfig: QueryConfig = {
  name: 'keeper-changelogs',
  defaultView: 'table',
  description:
    'Local Keeper changelog (WAL) files: log index range, entry count, modification time, size, and compressed/active/broken flags. Changelogs record every Raft log entry and are compacted once a snapshot covers their range.',
  optional: true,
  tableCheck: 'system.keeper_changelogs',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/keeper_changelogs',
  sql: [
    {
      since: '26.6',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            path,
            modification_time,
            from_log_index,
            to_log_index,
            entries,
            is_compressed,
            active,
            is_broken,
            size_bytes,
            formatReadableSize(size_bytes) AS readable_size_bytes,
            round(size_bytes * 100.0 / nullIf(max(size_bytes) OVER (), 0), 2) AS pct_size_bytes
        FROM system.keeper_changelogs
        ORDER BY from_log_index DESC
        LIMIT 100
      `,
    },
  ],
  columns: [
    'path',
    'modification_time',
    'from_log_index',
    'to_log_index',
    'entries',
    'active',
    'is_broken',
    'readable_size_bytes',
  ],
  columnFormats: {
    path: ColumnFormat.Text,
    modification_time: ColumnFormat.RelatedTime,
    from_log_index: ColumnFormat.Number,
    to_log_index: ColumnFormat.Number,
    entries: ColumnFormat.Number,
    active: ColumnFormat.Boolean,
    is_broken: ColumnFormat.Boolean,
    readable_size_bytes: ColumnFormat.BackgroundBar,
  },
}

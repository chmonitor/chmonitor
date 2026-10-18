import type { QueryConfig } from '@/types/query-config'

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { ColumnFormat } from '@/types/column-format'

/**
 * Keeper snapshot files — local snapshot metadata.
 * Requires ClickHouse 26.6+ with Keeper co-located on this node.
 */
export const keeperSnapshotsConfig: QueryConfig = {
  name: 'keeper-snapshots',
  defaultView: 'table',
  description:
    'Local Keeper snapshot files: path, last log index, modification time, and size. Snapshots are periodic full images of the Keeper znode tree used for recovery and log compaction.',
  optional: true,
  tableCheck: 'system.keeper_snapshots',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/keeper_snapshots',
  sql: [
    {
      since: '26.6',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            path,
            last_log_index,
            last_modified_at,
            size_bytes,
            formatReadableSize(size_bytes) AS readable_size_bytes,
            round(size_bytes * 100.0 / nullIf(max(size_bytes) OVER (), 0), 2) AS pct_size_bytes
        FROM system.keeper_snapshots
        ORDER BY last_modified_at DESC
        LIMIT 100
      `,
    },
  ],
  columns: [
    'path',
    'last_log_index',
    'last_modified_at',
    'readable_size_bytes',
  ],
  columnFormats: {
    path: ColumnFormat.Text,
    last_log_index: ColumnFormat.Number,
    last_modified_at: ColumnFormat.RelatedTime,
    readable_size_bytes: ColumnFormat.BackgroundBar,
  },
}

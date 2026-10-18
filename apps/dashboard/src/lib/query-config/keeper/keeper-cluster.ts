import type { QueryConfig } from '@/types/query-config'

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { ColumnFormat } from '@/types/column-format'

/**
 * Keeper Raft cluster membership — one row per Keeper node.
 * Requires ClickHouse 26.6+ with Keeper co-located on this node.
 */
export const keeperClusterConfig: QueryConfig = {
  name: 'keeper-cluster',
  defaultView: 'auto',
  card: { primary: 'host', badges: ['is_leader'] },
  description:
    'Raft cluster membership as seen from this Keeper node: server IDs, hosts, Raft endpoints, leader/observer flags, election priority, and last log index.',
  optional: true,
  tableCheck: 'system.keeper_cluster',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/keeper_cluster',
  sql: [
    {
      since: '26.6',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            server_id,
            host,
            endpoint,
            is_leader,
            is_observer,
            is_self,
            priority,
            last_log_index
        FROM system.keeper_cluster
        ORDER BY server_id ASC
      `,
    },
  ],
  columns: [
    'server_id',
    'host',
    'endpoint',
    'is_leader',
    'is_observer',
    'is_self',
    'priority',
    'last_log_index',
  ],
  columnFormats: {
    server_id: ColumnFormat.Number,
    host: ColumnFormat.Text,
    endpoint: ColumnFormat.Text,
    is_leader: ColumnFormat.Boolean,
    is_observer: ColumnFormat.Boolean,
    is_self: ColumnFormat.Boolean,
    priority: ColumnFormat.Number,
    last_log_index: ColumnFormat.Number,
  },
}

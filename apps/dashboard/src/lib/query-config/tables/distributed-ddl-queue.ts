import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const distributedDdlQueueConfig: QueryConfig = {
  name: 'distributed-ddl-queue',
  defaultView: 'auto',
  card: { primary: 'query', badges: ['status'] },
  description:
    'Distributed ddl queries (ON CLUSTER clause) that were executed on a cluster',
  optional: true,
  suggestion: `To use Distributed DDL Queue:

1. Set up cluster with replicas:
CREATE TABLE t ON CLUSTER cluster_name
(id Int32) ENGINE=ReplicatedMergeTree()

2. Enable distributed DDL:
SET distributed_ddl_queue_enabled = 1;

3. Run DDL on cluster:
CREATE TABLE ... ON CLUSTER cluster_name

Requires: Cluster + Keeper/ZooKeeper

Learn more:
https://clickhouse.com/docs/en/operations/system-tables/distributed_ddl_queue`,
  // Without Keeper the table exists but reading it fails with
  // NO_ELEMENTS_IN_CONFIG (#3919); system.zookeeper exists only with Keeper.
  tableCheck: ['system.distributed_ddl_queue', 'system.zookeeper'],
  sql: `
      SELECT
        entry,
        status,
        entry_version,
        format('{}:{}', initiator_host, toString(initiator_port)) AS initiator,
        cluster,
        query,
        toString(settings) AS settings,
        format('{}:{}', host, toString(port)) AS host,
        exception_code,
        exception_text,
        query_finish_time,
        query_duration_ms
      FROM system.distributed_ddl_queue
      ORDER BY entry DESC, host
      LIMIT 10000
    `,
  columns: [
    'entry',
    'status',
    'entry_version',
    'initiator',
    'cluster',
    'query',
    'settings',
    'host',
    'exception_code',
    'exception_text',
    'query_finish_time',
    'query_duration_ms',
  ],
  columnFormats: {
    status: ColumnFormat.ColoredBadge,
    query: ColumnFormat.CodeDialog,
    settings: ColumnFormat.CodeDialog,
    exception_text: ColumnFormat.CodeDialog,
  },
}

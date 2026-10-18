import type { DeclarativeQueryConfig } from '../../schema'

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'

export const clustersTopologyDeclarative: DeclarativeQueryConfig = {
  name: 'clusters-topology',
  defaultView: 'auto',
  card: { primary: 'host_name', badges: ['is_local'] },
  description:
    'Per-replica rows from system.clusters for the Cluster Topology graph (one row per cluster/shard/replica).',
  sql: [
    {
      // Baseline: 23.3 has no internal_replication, database_shard_name or
      // database_replica_name, so those are stubbed too; the 24.10 columns
      // are synthesized as NULL. The column set is identical across versions.
      since: '23.3',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            cluster,
            shard_num,
            shard_weight,
            toUInt8(0) AS internal_replication,
            replica_num,
            host_name,
            host_address,
            port,
            is_local,
            user,
            default_database,
            errors_count,
            slowdowns_count,
            toUInt32(estimated_recovery_time) AS estimated_recovery_time,
            '' AS database_shard_name,
            '' AS database_replica_name,
            CAST(NULL AS Nullable(UInt8)) AS is_active,
            CAST(NULL AS Nullable(UInt32)) AS replication_lag,
            CAST(NULL AS Nullable(UInt64)) AS recovery_time
        FROM system.clusters
        ORDER BY cluster ASC, shard_num ASC, replica_num ASC
      `,
    },
    {
      // 23.8: database_shard_name / database_replica_name exist;
      // internal_replication is still stubbed.
      since: '23.8',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            cluster,
            shard_num,
            shard_weight,
            toUInt8(0) AS internal_replication,
            replica_num,
            host_name,
            host_address,
            port,
            is_local,
            user,
            default_database,
            errors_count,
            slowdowns_count,
            toUInt32(estimated_recovery_time) AS estimated_recovery_time,
            database_shard_name,
            database_replica_name,
            CAST(NULL AS Nullable(UInt8)) AS is_active,
            CAST(NULL AS Nullable(UInt32)) AS replication_lag,
            CAST(NULL AS Nullable(UInt64)) AS recovery_time
        FROM system.clusters
        ORDER BY cluster ASC, shard_num ASC, replica_num ASC
      `,
    },
    {
      // 24.3: internal_replication exists; the 24.10 columns are still
      // synthesized as NULL.
      since: '24.3',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            cluster,
            shard_num,
            shard_weight,
            internal_replication,
            replica_num,
            host_name,
            host_address,
            port,
            is_local,
            user,
            default_database,
            errors_count,
            slowdowns_count,
            toUInt32(estimated_recovery_time) AS estimated_recovery_time,
            database_shard_name,
            database_replica_name,
            CAST(NULL AS Nullable(UInt8)) AS is_active,
            CAST(NULL AS Nullable(UInt32)) AS replication_lag,
            CAST(NULL AS Nullable(UInt64)) AS recovery_time
        FROM system.clusters
        ORDER BY cluster ASC, shard_num ASC, replica_num ASC
      `,
    },
    {
      // 24.10 (PR #66703): real Replicated-DB health columns.
      since: '24.10',
      sql: `
        ${QUERY_COMMENT}
        SELECT
            cluster,
            shard_num,
            shard_weight,
            internal_replication,
            replica_num,
            host_name,
            host_address,
            port,
            is_local,
            user,
            default_database,
            errors_count,
            slowdowns_count,
            toUInt32(estimated_recovery_time) AS estimated_recovery_time,
            database_shard_name,
            database_replica_name,
            is_active,
            replication_lag,
            recovery_time
        FROM system.clusters
        ORDER BY cluster ASC, shard_num ASC, replica_num ASC
      `,
    },
  ],
  columns: [
    'cluster',
    'shard_num',
    'shard_weight',
    'internal_replication',
    'replica_num',
    'host_name',
    'host_address',
    'port',
    'is_local',
    'user',
    'default_database',
    'errors_count',
    'slowdowns_count',
    'estimated_recovery_time',
    'database_shard_name',
    'database_replica_name',
    'is_active',
    'replication_lag',
    'recovery_time',
  ],
  optional: false,
}

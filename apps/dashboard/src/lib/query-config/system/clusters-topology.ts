import type { QueryConfig } from '@/types/query-config'

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'

/**
 * Per-replica view of `system.clusters` used to build the Cluster Topology graph.
 *
 * Unlike `clustersConfig` (which aggregates to one row per cluster), this returns
 * one row per (cluster, shard, replica) so the UI can reconstruct the full
 * cluster → shard → replica hierarchy and detect a single host participating in
 * multiple clusters with a different shard/replica role each time (the overlapping
 * virtual-cluster story in the design).
 *
 * This is STRUCTURAL, slow-moving data — the consuming route caches it hard.
 *
 * Columns pulled here, and why:
 *  - `internal_replication` (24.3+; stubbed as 0 on 23.x): key signal that a
 *    shard is Replicated (writes fan out via the shard's own replication) vs
 *    plain Distributed.
 *  - `user` / `default_database` (all versions): connection identity per host.
 *  - `database_shard_name` / `database_replica_name` (23.8+; stubbed as '' on
 *    23.3; empty unless
 *    the cluster backs a Replicated database): sharpens physical-vs-logical
 *    detection — a non-empty value means this is a managed/logical (Replicated-DB)
 *    cluster regardless of name.
 *  - `is_active` / `replication_lag` / `recovery_time` (24.10+, Replicated-DB only,
 *    PR #66703): completes the Replicated-DB health story. Synthesized as NULL on
 *    older servers via the baseline branch so the column set is stable.
 *
 * `is_active` is Nullable(UInt8): meaningful only for Replicated-database clusters
 * (1 online, 0 offline). For ordinary config / Distributed / discovery clusters it
 * is always NULL ("unknown") — the model must NOT render NULL as down.
 */
export type ClusterTopologyRow = {
  cluster: string
  shard_num: number
  shard_weight: number
  internal_replication: number
  replica_num: number
  host_name: string
  host_address: string
  port: number
  is_local: number
  user: string
  default_database: string
  errors_count: number
  slowdowns_count: number
  estimated_recovery_time: number
  database_shard_name: string
  database_replica_name: string
  is_active: number | null
  replication_lag: number | null
  recovery_time: number | null
}

export const clustersTopologyConfig: QueryConfig = {
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
}

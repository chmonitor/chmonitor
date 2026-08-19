import { QUERY_COMMENT } from '@chm/clickhouse-client/constants' // pragma: allowlist secret
import { CLUSTER_FANOUT_SETTINGS } from '@/lib/cluster/fanout-settings'

const USER_DB_FILTER = `database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`

function wrapClusterView(innerSelect: string): string {
  return `
    ${QUERY_COMMENT}
    SELECT * FROM clusterAllReplicas(
      {cluster:String},
      view(
        SELECT
          hostName() AS node_host,
          ${innerSelect}
      )
    )
    ${CLUSTER_FANOUT_SETTINGS}
  `
}

export const CLUSTER_TABLES_QUERY = wrapClusterView(`
          database,
          name AS table,
          engine,
          sorting_key,
          partition_key,
          primary_key,
          create_table_query
        FROM system.tables
        WHERE ${USER_DB_FILTER}`)

export const CLUSTER_COLUMNS_QUERY = wrapClusterView(`
          database,
          table,
          name,
          type,
          ifNull(compression_codec, '') AS codec
        FROM system.columns
        WHERE ${USER_DB_FILTER}`)

export const CLUSTER_INDEXES_QUERY = wrapClusterView(`
          database,
          table,
          name,
          type,
          expr,
          toString(granularity) AS granularity
        FROM system.data_skipping_indices
        WHERE ${USER_DB_FILTER}`)

export const CLUSTER_PROJECTIONS_QUERY = wrapClusterView(`
          database,
          table,
          name,
          type,
          ifNull(query, '') AS query
        FROM system.projections
        WHERE ${USER_DB_FILTER}`)

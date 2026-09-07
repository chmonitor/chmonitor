import {
  CLUSTER_COLUMNS_QUERY,
  CLUSTER_INDEXES_QUERY,
  CLUSTER_PROJECTIONS_QUERY,
  CLUSTER_TABLES_QUERY,
} from './cluster-sql'
import { describe, expect, test } from 'bun:test'
import { QUERY_COMMENT } from '@chm/clickhouse-client/constants' // pragma: allowlist secret

const USER_DB_FILTER =
  "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')"

describe('schema-diff cluster SQL', () => {
  test('tables query fans out system.tables with user-db filter and query comment', () => {
    expect(CLUSTER_TABLES_QUERY).toContain(QUERY_COMMENT)
    expect(CLUSTER_TABLES_QUERY).toContain('clusterAllReplicas')
    expect(CLUSTER_TABLES_QUERY).toContain('hostName() AS node_host')
    expect(CLUSTER_TABLES_QUERY).toContain('FROM system.tables')
    expect(CLUSTER_TABLES_QUERY).toContain(USER_DB_FILTER)
    expect(CLUSTER_TABLES_QUERY).toContain('create_table_query')
  })

  test('columns query selects codec from system.columns', () => {
    expect(CLUSTER_COLUMNS_QUERY).toContain('FROM system.columns')
    expect(CLUSTER_COLUMNS_QUERY).toContain(
      "ifNull(compression_codec, '') AS codec"
    )
    expect(CLUSTER_COLUMNS_QUERY).toContain(USER_DB_FILTER)
  })

  test('indexes query stringifies granularity', () => {
    expect(CLUSTER_INDEXES_QUERY).toContain('FROM system.data_skipping_indices')
    expect(CLUSTER_INDEXES_QUERY).toContain(
      'toString(granularity) AS granularity'
    )
  })

  test('projections query keeps nullable query text', () => {
    expect(CLUSTER_PROJECTIONS_QUERY).toContain('FROM system.projections')
    expect(CLUSTER_PROJECTIONS_QUERY).toContain("ifNull(query, '') AS query")
  })
})

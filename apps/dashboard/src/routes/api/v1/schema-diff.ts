/**
 * Schema Diff API
 * GET /api/v1/schema-diff?host=0&source=0&target=1&scope=hosts|nodes
 *
 * Read-only catalog compare between two env-configured hosts, or two nodes of
 * the current host's cluster. Never executes DDL.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'
import { loadClusterNodes } from '@/lib/cluster/load-cluster-nodes'
import { pickFanoutCluster } from '@/lib/cluster/pick-fanout-cluster'
import {
  type ClusterNodePeer,
  rowBelongsToNode,
} from '@/lib/cluster/unique-nodes'
import {
  type CompareScope,
  parseCompareScope,
  parseOptionalInt,
  resolveCompareScope,
  resolvePair,
} from '@/lib/compare/scope'
import {
  assembleCatalog,
  buildChangePlan,
  type ColumnRow,
  compareCatalogs,
  emptySchemaDiffPayload,
  type IndexRow,
  type ProjectionRow,
  type SchemaCatalog,
  type TableRow,
} from '@/lib/schema-diff'
import {
  CLUSTER_COLUMNS_QUERY,
  CLUSTER_INDEXES_QUERY,
  CLUSTER_PROJECTIONS_QUERY,
  CLUSTER_TABLES_QUERY,
} from '@/lib/schema-diff/cluster-sql'

const USER_DB_FILTER = `database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`

const TABLES_QUERY = `
  SELECT
    database,
    name AS table,
    engine,
    sorting_key,
    partition_key,
    primary_key,
    create_table_query
  FROM system.tables
  WHERE ${USER_DB_FILTER}
  ORDER BY database, name
`

const COLUMNS_QUERY = `
  SELECT
    database,
    table,
    name,
    type,
    ifNull(compression_codec, '') AS codec
  FROM system.columns
  WHERE ${USER_DB_FILTER}
  ORDER BY database, table, position
`

const INDEXES_QUERY = `
  SELECT
    database,
    table,
    name,
    type,
    expr,
    toString(granularity) AS granularity
  FROM system.data_skipping_indices
  WHERE ${USER_DB_FILTER}
  ORDER BY database, table, name
`

const PROJECTIONS_QUERY = `
  SELECT
    database,
    table,
    name,
    type,
    ifNull(query, '') AS query
  FROM system.projections
  WHERE ${USER_DB_FILTER}
  ORDER BY database, table, name
`

type NodeHostRow = { node_host: string }

async function queryRows<T>(
  hostId: number,
  query: string,
  options?: { optional?: boolean; query_params?: Record<string, string> }
): Promise<T[]> {
  const result = await fetchData<T[]>({
    query,
    hostId,
    format: 'JSONEachRow',
    query_params: options?.query_params,
  })
  if (result.error || !result.data) {
    if (options?.optional) return []
    const message =
      result.error?.message ?? `Catalog query failed on host ${hostId}`
    throw new Error(message)
  }
  return result.data
}

async function loadCatalog(hostId: number): Promise<SchemaCatalog> {
  const [tables, columns, indexes, projections] = await Promise.all([
    queryRows<TableRow>(hostId, TABLES_QUERY),
    queryRows<ColumnRow>(hostId, COLUMNS_QUERY),
    queryRows<IndexRow>(hostId, INDEXES_QUERY, { optional: true }),
    queryRows<ProjectionRow>(hostId, PROJECTIONS_QUERY, { optional: true }),
  ])
  return assembleCatalog(tables, columns, indexes, projections)
}

function catalogForNode<T extends NodeHostRow>(
  rows: T[],
  node: ClusterNodePeer
): T[] {
  return rows.filter((row) => rowBelongsToNode(row.node_host, node))
}

async function loadNodeCatalogs(
  hostId: number,
  cluster: string,
  source: ClusterNodePeer,
  target: ClusterNodePeer
): Promise<[SchemaCatalog, SchemaCatalog]> {
  const params = { cluster }
  const [tables, columns, indexes, projections] = await Promise.all([
    queryRows<TableRow & NodeHostRow>(hostId, CLUSTER_TABLES_QUERY, {
      query_params: params,
    }),
    queryRows<ColumnRow & NodeHostRow>(hostId, CLUSTER_COLUMNS_QUERY, {
      query_params: params,
    }),
    queryRows<IndexRow & NodeHostRow>(hostId, CLUSTER_INDEXES_QUERY, {
      optional: true,
      query_params: params,
    }),
    queryRows<ProjectionRow & NodeHostRow>(hostId, CLUSTER_PROJECTIONS_QUERY, {
      optional: true,
      query_params: params,
    }),
  ])

  return [
    assembleCatalog(
      catalogForNode(tables, source),
      catalogForNode(columns, source),
      catalogForNode(indexes, source),
      catalogForNode(projections, source)
    ),
    assembleCatalog(
      catalogForNode(tables, target),
      catalogForNode(columns, target),
      catalogForNode(indexes, target),
      catalogForNode(projections, target)
    ),
  ]
}

function parseHostId(raw: string | null): number | null {
  const n = parseOptionalInt(raw)
  return n === undefined ? null : n
}

export const Route = createFileRoute('/api/v1/schema-diff')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        const configs = getClickHouseConfigsFromEnv(
          env as Record<string, string | undefined>
        )

        if (configs.length === 0) {
          return Response.json(
            { success: false, error: 'No ClickHouse hosts configured' },
            { status: 503 }
          )
        }

        if (
          await isDemoHostBlockedForRequest(
            0,
            env as Record<string, string | undefined>
          )
        ) {
          return Response.json(
            emptySchemaDiffPayload({
              success: true,
              hosts: [],
              nodes: [],
              scope: 'hosts' as CompareScope,
              sourceHostId: null,
              targetHostId: null,
              unavailable: demoHiddenUnavailable(),
            })
          )
        }

        const hosts = configs.map((c) => ({
          id: c.id,
          name: c.customName ?? c.host,
        }))

        const searchParams = new URL(request.url).searchParams
        const requestedSource = parseHostId(searchParams.get('source'))
        const requestedTarget = parseHostId(searchParams.get('target'))
        const requestedScope = parseCompareScope(searchParams.get('scope'))
        const requestedHost = parseHostId(searchParams.get('host'))
        const topologyHostId =
          requestedHost !== null && hosts.some((h) => h.id === requestedHost)
            ? requestedHost
            : (hosts[0]?.id ?? 0)

        const { nodes, rows: clusterRows } =
          await loadClusterNodes(topologyHostId)
        const nodePeers = nodes.map((n) => ({ id: n.id, name: n.name }))
        const scope = resolveCompareScope({
          hostCount: hosts.length,
          nodeCount: nodes.length,
          requested: requestedScope,
        })

        const empty = (
          sourceHostId: number | null,
          targetHostId: number | null
        ) =>
          emptySchemaDiffPayload({
            success: true,
            hosts,
            nodes: nodePeers,
            scope,
            sourceHostId,
            targetHostId,
          })

        if (scope === 'hosts' && hosts.length >= 2) {
          const ids = new Set(hosts.map((h) => h.id))
          const sourceHostId =
            requestedSource !== null && ids.has(requestedSource)
              ? requestedSource
              : hosts[0].id
          const fallbackTarget = hosts.find((h) => h.id !== sourceHostId)!.id
          const targetHostId =
            requestedTarget !== null &&
            ids.has(requestedTarget) &&
            requestedTarget !== sourceHostId
              ? requestedTarget
              : fallbackTarget

          try {
            const [sourceCatalog, targetCatalog] = await Promise.all([
              loadCatalog(sourceHostId),
              loadCatalog(targetHostId),
            ])

            const diff = compareCatalogs(sourceCatalog, targetCatalog)
            const plan = buildChangePlan(diff)

            return Response.json({
              success: true,
              hosts,
              nodes: nodePeers,
              scope,
              sourceHostId,
              targetHostId,
              diff,
              plan,
            })
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Catalog query failed'
            return Response.json(
              { success: false, error: message },
              { status: 502 }
            )
          }
        }

        if (scope === 'nodes' && nodes.length >= 2) {
          const pair = resolvePair(
            nodePeers,
            requestedSource ?? undefined,
            requestedTarget ?? undefined
          )
          if (!pair) {
            return Response.json(empty(nodes[0]?.id ?? null, null))
          }
          const sourceNode = nodes.find((n) => n.id === pair.sourceId)
          const targetNode = nodes.find((n) => n.id === pair.targetId)
          const cluster = pickFanoutCluster(clusterRows)
          if (!sourceNode || !targetNode || !cluster) {
            return Response.json(empty(pair.sourceId, pair.targetId))
          }

          try {
            const [sourceCatalog, targetCatalog] = await loadNodeCatalogs(
              topologyHostId,
              cluster,
              sourceNode,
              targetNode
            )
            const diff = compareCatalogs(sourceCatalog, targetCatalog)
            const plan = buildChangePlan(diff)
            return Response.json({
              success: true,
              hosts,
              nodes: nodePeers,
              scope,
              sourceHostId: pair.sourceId,
              targetHostId: pair.targetId,
              diff,
              plan,
            })
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Catalog query failed'
            return Response.json(
              { success: false, error: message },
              { status: 502 }
            )
          }
        }

        return Response.json(empty(hosts[0]?.id ?? null, null))
      },
    },
  },
})

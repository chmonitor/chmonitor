/**
 * Schema Diff API
 * GET/POST /api/v1/schema-diff?host=0&source=0&target=1&scope=hosts|nodes
 *
 * Read-only catalog compare between two merged hosts (env + database +
 * browser session) or two nodes of the current host's cluster. Never executes
 * DDL. POST carries browser session tokens so negative host ids resolve.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { bridgeClickHouseEnv } from '@/lib/api/server-env' // pragma: allowlist secret
import { demoHiddenUnavailable } from '@/lib/cloud/reject-demo-host'
import { loadClusterNodes } from '@/lib/cluster/load-cluster-nodes'
import { pickFanoutCluster } from '@/lib/cluster/pick-fanout-cluster'
import {
  type ClusterNodePeer,
  rowBelongsToNode,
} from '@/lib/cluster/unique-nodes'
import {
  type DiffPeer,
  queryDiffPeer,
  readDiffRequest,
  resolveMergedDiffHosts,
  toHostInfo,
} from '@/lib/compare/merged-diff-hosts'
import {
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

async function loadCatalog(peer: DiffPeer): Promise<SchemaCatalog> {
  const [tables, columns, indexes, projections] = await Promise.all([
    queryDiffPeer<TableRow>(peer, { query: TABLES_QUERY }),
    queryDiffPeer<ColumnRow>(peer, { query: COLUMNS_QUERY }),
    queryDiffPeer<IndexRow>(peer, { query: INDEXES_QUERY, optional: true }),
    queryDiffPeer<ProjectionRow>(peer, {
      query: PROJECTIONS_QUERY,
      optional: true,
    }),
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
  peer: DiffPeer,
  cluster: string,
  source: ClusterNodePeer,
  target: ClusterNodePeer
): Promise<[SchemaCatalog, SchemaCatalog]> {
  const params = { cluster }
  const [tables, columns, indexes, projections] = await Promise.all([
    queryDiffPeer<TableRow & NodeHostRow>(peer, {
      query: CLUSTER_TABLES_QUERY,
      query_params: params,
    }),
    queryDiffPeer<ColumnRow & NodeHostRow>(peer, {
      query: CLUSTER_COLUMNS_QUERY,
      query_params: params,
    }),
    queryDiffPeer<IndexRow & NodeHostRow>(peer, {
      optional: true,
      query: CLUSTER_INDEXES_QUERY,
      query_params: params,
    }),
    queryDiffPeer<ProjectionRow & NodeHostRow>(peer, {
      optional: true,
      query: CLUSTER_PROJECTIONS_QUERY,
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

async function handleSchemaDiff(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>) // pragma: allowlist secret

  const { search, browserSessions } = await readDiffRequest(request)
  const { peers, demoBlocked } = await resolveMergedDiffHosts({
    bindings: env as Record<string, string | undefined>,
    browserSessions,
  })

  const hosts = peers.map(toHostInfo)
  const requestedSource = parseOptionalInt(search.get('source'))
  const requestedTarget = parseOptionalInt(search.get('target'))
  const requestedScope = parseCompareScope(search.get('scope'))
  const requestedHost = parseOptionalInt(search.get('host'))
  const topologyPeer =
    (requestedHost !== undefined
      ? peers.find((p) => p.id === requestedHost)
      : undefined) ?? peers[0]

  const { nodes, rows: clusterRows } = topologyPeer
    ? await loadClusterNodes(topologyPeer)
    : { nodes: [], rows: [] }
  const nodePeers = nodes.map((n) => ({ id: n.id, name: n.name }))
  const scope = resolveCompareScope({
    hostCount: hosts.length,
    nodeCount: nodes.length,
    requested: requestedScope,
  })

  const empty = (
    sourceHostId: number | null,
    targetHostId: number | null,
    unavailable?: { reason: string; message: string }
  ) =>
    emptySchemaDiffPayload({
      success: true,
      hosts,
      nodes: nodePeers,
      scope,
      sourceHostId,
      targetHostId,
      ...(unavailable ? { unavailable } : {}),
    })

  if (peers.length === 0 && demoBlocked) {
    return Response.json(empty(null, null, demoHiddenUnavailable()))
  }

  if (scope === 'hosts' && hosts.length >= 2) {
    const pair = resolvePair(hosts, requestedSource, requestedTarget)
    if (!pair) {
      return Response.json(empty(hosts[0]?.id ?? null, null))
    }
    const sourcePeer = peers.find((p) => p.id === pair.sourceId)
    const targetPeer = peers.find((p) => p.id === pair.targetId)
    if (!sourcePeer || !targetPeer) {
      return Response.json(empty(pair.sourceId, pair.targetId))
    }

    try {
      const [sourceCatalog, targetCatalog] = await Promise.all([
        loadCatalog(sourcePeer),
        loadCatalog(targetPeer),
      ])
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
      return Response.json({ success: false, error: message }, { status: 502 })
    }
  }

  if (scope === 'nodes' && nodes.length >= 2 && topologyPeer) {
    const pair = resolvePair(nodePeers, requestedSource, requestedTarget)
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
        topologyPeer,
        cluster,
        sourceNode,
        targetNode
      )
      const diff = compareCatalogs(sourceCatalog, targetCatalog)
      const plan = buildChangePlan(diff, { cluster })
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
      return Response.json({ success: false, error: message }, { status: 502 })
    }
  }

  return Response.json(empty(hosts[0]?.id ?? null, null))
}

export const Route = createFileRoute('/api/v1/schema-diff')({
  server: {
    handlers: {
      GET: async ({ request }) => handleSchemaDiff(request),
      POST: async ({ request }) => handleSchemaDiff(request),
    },
  },
})

/**
 * Settings Diff API
 * GET/POST /api/v1/settings-diff?host=0&source=0&target=1&scope=hosts|nodes&view=matrix|pair
 *
 * Cross-host or cluster-node comparison of system.settings and
 * system.merge_tree_settings. Hosts are the merged set (env + database +
 * browser session). One host compares against defaults. Read-only.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { SettingsDiffView } from '@/lib/settings-diff/search'
import type { SettingsDiffHostInfo } from '@/lib/settings-diff/types'

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
  type CompareScope,
  parseCompareScope,
  parseOptionalInt,
  resolveCompareScope,
  resolvePair,
} from '@/lib/compare/scope'
import {
  CLUSTER_MERGE_TREE_SETTINGS_QUERY,
  CLUSTER_SETTINGS_QUERY,
} from '@/lib/settings-diff/cluster-sql'
import { mergeSettingsDiff, type SettingRow } from '@/lib/settings-diff/merge'
import { parseSettingsDiffView } from '@/lib/settings-diff/search'

const SETTINGS_QUERY = `
  SELECT name, value, changed, description, default AS defaultValue
  FROM system.settings
  ORDER BY name
`

const MERGE_TREE_QUERY = `
  SELECT name, value, changed, description, default AS defaultValue
  FROM system.merge_tree_settings
  ORDER BY name
`

type FetchTask = {
  peer: DiffPeer
  table: 'settings' | 'merge_tree_settings'
  query: string
}

async function runTasks(tasks: FetchTask[]) {
  const results = await Promise.allSettled(
    tasks.map((t) =>
      queryDiffPeer<SettingRow>(t.peer, {
        query: t.query,
        optional: true,
      }).then((rows) => ({ ...t, rows }))
    )
  )

  const batches = []
  for (const outcome of results) {
    if (outcome.status === 'rejected') continue
    const { peer, table, rows } = outcome.value
    if (!rows.length) continue
    batches.push({ peerId: peer.id, table, rows })
  }
  return mergeSettingsDiff(batches)
}

type NodeSettingRow = SettingRow & { node_host: string }

async function runNodeTasks(
  peer: DiffPeer,
  cluster: string,
  source: ClusterNodePeer,
  target: ClusterNodePeer
) {
  const params = { cluster }
  const tasks: Array<{
    table: 'settings' | 'merge_tree_settings'
    query: string
  }> = [
    { table: 'settings', query: CLUSTER_SETTINGS_QUERY },
    { table: 'merge_tree_settings', query: CLUSTER_MERGE_TREE_SETTINGS_QUERY },
  ]

  const results = await Promise.allSettled(
    tasks.map((t) =>
      queryDiffPeer<NodeSettingRow>(peer, {
        query: t.query,
        query_params: params,
        optional: true,
      }).then((rows) => ({ ...t, rows }))
    )
  )

  const batches = []
  for (const outcome of results) {
    if (outcome.status === 'rejected') continue
    const { table, rows } = outcome.value
    if (!rows.length) continue
    for (const node of [source, target]) {
      batches.push({
        peerId: node.id,
        table,
        rows: rows
          .filter((row) => rowBelongsToNode(row.node_host, node))
          .map(({ name, value, changed, description, defaultValue }) => ({
            name,
            value,
            changed,
            description,
            defaultValue,
          })),
      })
    }
  }
  return mergeSettingsDiff(batches)
}

function jsonOk(body: {
  hosts: SettingsDiffHostInfo[]
  nodes: SettingsDiffHostInfo[]
  scope: CompareScope
  view: SettingsDiffView
  sourceHostId: number | null
  targetHostId: number | null
  rows: ReturnType<typeof mergeSettingsDiff>
  unavailable?: { reason: string; message: string }
}) {
  return Response.json({ success: true, ...body })
}

function hostsToQuery(
  peers: DiffPeer[],
  view: SettingsDiffView,
  source?: number,
  target?: number
): DiffPeer[] {
  if (peers.length < 2 || view !== 'pair') return peers
  const pair = resolvePair(peers.map(toHostInfo), source, target)
  if (!pair) return peers
  return peers.filter((p) => p.id === pair.sourceId || p.id === pair.targetId)
}

async function handleSettingsDiff(request: Request): Promise<Response> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>) // pragma: allowlist secret

  const { search, browserSessions } = await readDiffRequest(request)
  const { peers, demoBlocked } = await resolveMergedDiffHosts({
    bindings: env as Record<string, string | undefined>,
    browserSessions,
  })

  const hosts: SettingsDiffHostInfo[] = peers.map(toHostInfo)
  const requestedSource = parseOptionalInt(search.get('source'))
  const requestedTarget = parseOptionalInt(search.get('target'))
  const requestedScope = parseCompareScope(search.get('scope'))
  const requestedView = parseSettingsDiffView(search.get('view'))
  const requestedHost = parseOptionalInt(search.get('host'))
  const topologyPeer =
    (requestedHost !== undefined
      ? peers.find((p) => p.id === requestedHost)
      : undefined) ?? peers[0]

  const { nodes, rows: clusterRows } = topologyPeer
    ? await loadClusterNodes(topologyPeer)
    : { nodes: [], rows: [] }
  const nodePeers: SettingsDiffHostInfo[] = nodes.map((n) => ({
    id: n.id,
    name: n.name,
  }))
  const scope = resolveCompareScope({
    hostCount: hosts.length,
    nodeCount: nodes.length,
    requested: requestedScope,
  })
  const view: SettingsDiffView =
    requestedView ??
    (hosts.length >= 2 &&
    requestedSource !== undefined &&
    requestedTarget !== undefined
      ? 'pair'
      : 'matrix')

  if (peers.length === 0 && demoBlocked) {
    return jsonOk({
      hosts: [],
      nodes: [],
      scope: 'hosts',
      view: 'matrix',
      sourceHostId: null,
      targetHostId: null,
      rows: [],
      unavailable: demoHiddenUnavailable(),
    })
  }

  if (scope === 'nodes' && nodes.length >= 2 && topologyPeer) {
    const pair = resolvePair(nodePeers, requestedSource, requestedTarget)
    if (!pair) {
      return jsonOk({
        hosts,
        nodes: nodePeers,
        scope,
        view,
        sourceHostId: null,
        targetHostId: null,
        rows: [],
      })
    }
    const sourceNode = nodes.find((n) => n.id === pair.sourceId)
    const targetNode = nodes.find((n) => n.id === pair.targetId)
    const cluster = pickFanoutCluster(clusterRows)
    if (!sourceNode || !targetNode || !cluster) {
      return jsonOk({
        hosts,
        nodes: nodePeers,
        scope,
        view,
        sourceHostId: pair.sourceId,
        targetHostId: pair.targetId,
        rows: [],
      })
    }

    const rows = await runNodeTasks(
      topologyPeer,
      cluster,
      sourceNode,
      targetNode
    )
    return jsonOk({
      hosts,
      nodes: nodePeers,
      scope,
      view,
      sourceHostId: pair.sourceId,
      targetHostId: pair.targetId,
      rows,
    })
  }

  const selectedPeers = hostsToQuery(
    peers,
    view,
    requestedSource,
    requestedTarget
  )
  const tasks: FetchTask[] = selectedPeers.flatMap((peer) => [
    { peer, table: 'settings', query: SETTINGS_QUERY },
    { peer, table: 'merge_tree_settings', query: MERGE_TREE_QUERY },
  ])
  const rows = await runTasks(tasks)
  const pair =
    hosts.length >= 2
      ? resolvePair(hosts, requestedSource, requestedTarget)
      : null

  return jsonOk({
    hosts,
    nodes: nodePeers,
    scope: 'hosts',
    view,
    sourceHostId:
      view === 'pair'
        ? (pair?.sourceId ?? hosts[0]?.id ?? null)
        : (hosts[0]?.id ?? null),
    targetHostId: view === 'pair' ? (pair?.targetId ?? null) : null,
    rows,
  })
}

export const Route = createFileRoute('/api/v1/settings-diff')({
  server: {
    handlers: {
      GET: async ({ request }) => handleSettingsDiff(request),
      POST: async ({ request }) => handleSettingsDiff(request),
    },
  },
})

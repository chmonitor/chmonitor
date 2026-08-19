/**
 * Settings Diff API Endpoint
 * GET /api/v1/settings-diff?host=0&source=0&target=1&scope=hosts|nodes
 *
 * Cross-host or cluster-node comparison of system.settings and
 * system.merge_tree_settings. Read-only — no writes.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { SettingsDiffHostInfo } from '@/lib/settings-diff/types'

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
  CLUSTER_MERGE_TREE_SETTINGS_QUERY,
  CLUSTER_SETTINGS_QUERY,
} from '@/lib/settings-diff/cluster-sql'
import { mergeSettingsDiff, type SettingRow } from '@/lib/settings-diff/merge'

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
  peerId: number
  table: 'settings' | 'merge_tree_settings'
  query: string
  hostId: number
  query_params?: Record<string, string>
}

async function runTasks(tasks: FetchTask[]) {
  const results = await Promise.allSettled(
    tasks.map((t) =>
      fetchData<SettingRow[]>({
        query: t.query,
        hostId: t.hostId,
        format: 'JSONEachRow',
        query_params: t.query_params,
      }).then((r) => ({ ...t, result: r }))
    )
  )

  const batches = []
  for (const outcome of results) {
    if (outcome.status === 'rejected') continue
    const { peerId, table, result } = outcome.value
    if (result.error || !result.data) continue
    batches.push({ peerId, table, rows: result.data })
  }
  return mergeSettingsDiff(batches)
}

type NodeSettingRow = SettingRow & { node_host: string }

async function runNodeTasks(
  hostId: number,
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
      fetchData<NodeSettingRow[]>({
        query: t.query,
        hostId,
        format: 'JSONEachRow',
        query_params: params,
      }).then((r) => ({ ...t, result: r }))
    )
  )

  const batches = []
  for (const outcome of results) {
    if (outcome.status === 'rejected') continue
    const { table, result } = outcome.value
    if (result.error || !result.data) continue
    for (const node of [source, target]) {
      batches.push({
        peerId: node.id,
        table,
        rows: result.data
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
  sourceHostId: number | null
  targetHostId: number | null
  rows: ReturnType<typeof mergeSettingsDiff>
  unavailable?: { reason: string; message: string }
}) {
  return Response.json({ success: true, ...body })
}

export const Route = createFileRoute('/api/v1/settings-diff')({
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
          return jsonOk({
            hosts: [],
            nodes: [],
            scope: 'hosts',
            sourceHostId: null,
            targetHostId: null,
            rows: [],
            unavailable: demoHiddenUnavailable(),
          })
        }

        const hosts: SettingsDiffHostInfo[] = configs.map((c) => ({
          id: c.id,
          name: c.customName ?? c.host,
        }))

        const searchParams = new URL(request.url).searchParams
        const requestedSource = parseOptionalInt(searchParams.get('source'))
        const requestedTarget = parseOptionalInt(searchParams.get('target'))
        const requestedScope = parseCompareScope(searchParams.get('scope'))
        const requestedHost = parseOptionalInt(searchParams.get('host'))
        const topologyHostId =
          requestedHost !== undefined &&
          hosts.some((h) => h.id === requestedHost)
            ? requestedHost
            : (hosts[0]?.id ?? 0)

        const { nodes, rows: clusterRows } =
          await loadClusterNodes(topologyHostId)
        const nodePeers: SettingsDiffHostInfo[] = nodes.map((n) => ({
          id: n.id,
          name: n.name,
        }))
        const scope = resolveCompareScope({
          hostCount: hosts.length,
          nodeCount: nodes.length,
          requested: requestedScope,
        })

        if (scope === 'nodes' && nodes.length >= 2) {
          const pair = resolvePair(nodePeers, requestedSource, requestedTarget)
          if (!pair) {
            return jsonOk({
              hosts,
              nodes: nodePeers,
              scope,
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
              sourceHostId: pair.sourceId,
              targetHostId: pair.targetId,
              rows: [],
            })
          }

          const rows = await runNodeTasks(
            topologyHostId,
            cluster,
            sourceNode,
            targetNode
          )
          return jsonOk({
            hosts,
            nodes: nodePeers,
            scope,
            sourceHostId: pair.sourceId,
            targetHostId: pair.targetId,
            rows,
          })
        }

        const tasks: FetchTask[] = configs.flatMap((cfg) => [
          {
            peerId: cfg.id,
            hostId: cfg.id,
            table: 'settings',
            query: SETTINGS_QUERY,
          },
          {
            peerId: cfg.id,
            hostId: cfg.id,
            table: 'merge_tree_settings',
            query: MERGE_TREE_QUERY,
          },
        ])
        const rows = await runTasks(tasks)
        const pair = resolvePair(hosts, requestedSource, requestedTarget)

        return jsonOk({
          hosts,
          nodes: nodePeers,
          scope: 'hosts',
          sourceHostId: pair?.sourceId ?? hosts[0]?.id ?? null,
          targetHostId: pair?.targetId ?? null,
          rows,
        })
      },
    },
  },
})

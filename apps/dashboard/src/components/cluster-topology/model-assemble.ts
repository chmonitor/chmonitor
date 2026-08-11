/**
 * Assemble the layout-free structural topology (`TopologyData`) from raw
 * ClickHouse rows: `clusters-topology` (system.clusters), `keeper-info`
 * (system.zookeeper_info, optional), `keeper-presence`
 * (system.zookeeper_connection, optional), and an optional all-node live
 * snapshot. Pure — safe to run server-side (the /api/v1/cluster-topology
 * route serializes the result to JSON). No x/y — see `model-layout.ts` for
 * the layout stage that adds coordinates.
 *
 * RESILIENCE: structural truth always comes from system.clusters (local, always
 * available). Live numbers come from the best-effort cluster fan-out. A node that
 * is in system.clusters but absent from the live snapshot is `unreachable` with
 * NULL metrics — never fabricated zeros.
 */

import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'
import type {
  ChNode,
  ChStatus,
  ClusterInfo,
  KeeperNode,
  KeeperRole,
  KeeperSource,
  NodeLiveMetrics,
  TopologyData,
  TopologyMeta,
} from './model'

import { CLUSTER_PALETTE } from './model-constants'
import {
  deriveKeeperRole,
  isLoopbackAddr,
  isPhysicalName,
  isReplicatedDbRow,
  nameScore,
  num,
  numOrNull,
  shortId,
  truthy,
} from './model-parse'

/** Keeper-info raw row shape (subset of keeper-info columns we use). */
export interface KeeperInfoRow {
  zookeeper_cluster_name?: string
  host: string
  port: number
  is_connected: number | boolean
  server_state?: string
  is_leader: number | boolean
  version?: string
  avg_latency?: number
  znode_count?: number
  watch_count?: number
  outstanding_requests?: number
}

/** keeper-presence raw row shape (system.zookeeper_connection). */
export interface KeeperPresenceRow {
  name?: string
  host?: string
  port?: number
  is_expired?: number | boolean
  enabled_feature_flags?: string[] | null
}

/** Live fan-out raw row shape (cluster-live-metrics-all / cluster-live-metrics). */
export interface ClusterLiveRow {
  hostname?: string
  cpu_pct?: number | string
  mem_used_bytes?: number | string
  mem_total_bytes?: number | string
  mem_available_bytes?: number | string
  disk_used_bytes?: number | string
  disk_total_bytes?: number | string
  active_queries?: number | string
  uptime_seconds?: number | string
  version?: string
}

/**
 * Detect the coordination layer source from the presence/info rows.
 *  - keeper-info rows present → use them (richest).
 *  - presence rows present → coordination reachable; embedded Keeper vs external
 *    ZK is a soft hint from enabled_feature_flags / port.
 *  - neither → none.
 */
function detectKeeperSource(
  keeperRows: KeeperInfoRow[],
  presenceRows: KeeperPresenceRow[]
): KeeperSource {
  const hasInfo = keeperRows.some((r) => r?.host)
  const hasPresence = presenceRows.some((r) => r?.host)
  if (!hasInfo && !hasPresence) return 'none'
  // embedded Keeper exposes feature flags (25.1+) and defaults to port 9181.
  const embedded = presenceRows.some(
    (r) =>
      (Array.isArray(r.enabled_feature_flags) &&
        r.enabled_feature_flags.length > 0) ||
      num(r.port) === 9181
  )
  if (embedded) return 'keeper'
  // external ZooKeeper defaults to 2181, no feature flags.
  const external = presenceRows.some((r) => num(r.port) === 2181)
  if (external) return 'zookeeper'
  // info rows but no clear hint: default to keeper (system.zookeeper_info is
  // ClickHouse-Keeper-specific).
  return hasInfo ? 'keeper' : 'zookeeper'
}

/**
 * Assemble the layout-free structural topology from raw ClickHouse rows.
 * Pure — safe to run server-side.
 */
export function assembleTopology(
  clusterRows: ClusterTopologyRow[],
  keeperRows: KeeperInfoRow[],
  presenceRows: KeeperPresenceRow[] = [],
  liveRows: ClusterLiveRow[] = [],
  liveSource: TopologyMeta['liveSource'] = 'none'
): TopologyData {
  // ── 1. collect unique CH hosts across all clusters ──
  // A host key combines name+port so the same machine listed in multiple clusters
  // maps to ONE node (the overlapping-territory story).
  const hostKey = (r: { host_name: string; port: number }) =>
    `${r.host_name}:${r.port}`

  // ── machine-identity merge ──────────────────────────────────────────────
  // system.clusters is evaluated on the ONE server we queried, so EVERY row with
  // is_local=1 is that SAME physical machine — even when listed under different
  // host_names across clusters (the implicit `default` cluster lists `localhost`
  // while the operator cluster lists the pod FQDN `chi-...-0-0`). Without this,
  // the local server is drawn twice (`localhost` AND `chi-...-0-0`). We union:
  //   (a) all is_local rows → one node (definitive: same queried server), and
  //   (b) rows sharing a ROUTABLE host_address:port → one node (catches a
  //       hostname-vs-IP duplicate of a remote node; loopback addrs excluded).
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const r of clusterRows) {
    const k = hostKey(r)
    if (!parent.has(k)) parent.set(k, k)
  }
  let localAnchor: string | null = null
  const addrSeen = new Map<string, string>()
  for (const r of clusterRows) {
    const k = hostKey(r)
    if (truthy(r.is_local)) {
      if (localAnchor === null) localAnchor = k
      else union(localAnchor, k)
    }
    if (!isLoopbackAddr(r.host_address)) {
      const ak = `${r.host_address}:${num(r.port)}`
      const prev = addrSeen.get(ak)
      if (prev) union(prev, k)
      else addrSeen.set(ak, k)
    }
  }
  // Canonical machine key for a row (the union-find root of its raw host key).
  const canonKey = (r: { host_name: string; port: number }) => find(hostKey(r))

  const hostOrder: string[] = []
  const hostMeta = new Map<
    string,
    {
      row: ClusterTopologyRow
      errors: number
      slowdowns: number
      replicationLag: number | null
      isLocal: boolean
      /** every host_name + host_address seen for this machine, for live matching */
      aliases: Set<string>
    }
  >()

  for (const r of clusterRows) {
    const k = canonKey(r)
    const existing = hostMeta.get(k)
    if (!existing) {
      hostOrder.push(k)
      hostMeta.set(k, {
        row: r,
        errors: num(r.errors_count),
        slowdowns: num(r.slowdowns_count),
        replicationLag: numOrNull(r.replication_lag),
        isLocal: truthy(r.is_local),
        aliases: new Set([r.host_name, r.host_address].filter(Boolean)),
      })
    } else {
      existing.errors += num(r.errors_count)
      existing.slowdowns += num(r.slowdowns_count)
      const lag = numOrNull(r.replication_lag)
      if (lag !== null)
        existing.replicationLag = Math.max(existing.replicationLag ?? 0, lag)
      existing.isLocal = existing.isLocal || truthy(r.is_local)
      existing.aliases.add(r.host_name)
      if (r.host_address) existing.aliases.add(r.host_address)
      // Keep the most descriptive name as this machine's representative row, so
      // a merged `localhost`/FQDN pair displays the FQDN, not `localhost`.
      if (nameScore(r.host_name) > nameScore(existing.row.host_name))
        existing.row = r
    }
  }

  // ── live metrics, keyed by hostname so we can left-join structure ← live ──
  const liveByHost = new Map<string, NodeLiveMetrics>()
  for (const lr of liveRows) {
    const host = lr.hostname
    if (!host) continue
    liveByHost.set(host, {
      cpuPct: numOrNull(lr.cpu_pct),
      memUsed: numOrNull(lr.mem_used_bytes),
      memTotal: numOrNull(lr.mem_total_bytes),
      memAvailable: numOrNull(lr.mem_available_bytes),
      diskUsed: numOrNull(lr.disk_used_bytes),
      diskTotal: numOrNull(lr.disk_total_bytes),
      activeQueries: numOrNull(lr.active_queries),
      uptimeSeconds: numOrNull(lr.uptime_seconds),
      version: lr.version ?? null,
    })
  }
  // A live fan-out can match by ANY of a machine's aliases (host_name or resolved
  // host_address) collected across the clusters that list it.
  const matchLive = (aliases: Set<string>): NodeLiveMetrics | undefined => {
    for (const a of aliases) {
      const v = liveByHost.get(a)
      if (v) return v
    }
    return undefined
  }

  const idByCanonKey = new Map<string, string>()
  const chNodes: ChNode[] = hostOrder.map((k, i) => {
    const { row, errors, slowdowns, replicationLag, isLocal, aliases } =
      hostMeta.get(k)!
    const id = shortId(row.host_name, i)
    idByCanonKey.set(k, id)
    const isActive = row.is_active
    const inactive =
      isActive !== null && isActive !== undefined && !truthy(isActive)
    const live = matchLive(aliases) ?? null
    // status precedence: down (is_active=0) → warn (errors) →
    // unreachable (expected by fan-out but no live row) → healthy.
    let status: ChStatus
    if (inactive) {
      status = 'down'
    } else if (errors > 0) {
      status = 'warn'
    } else if (liveSource === 'fanout' && !live) {
      status = 'unreachable'
    } else {
      status = 'healthy'
    }
    return {
      id,
      host: row.host_name,
      address: row.host_address,
      port: num(row.port),
      isLocal,
      status,
      errors,
      slowdowns,
      recoveryTime: num(row.estimated_recovery_time),
      isActive: isActive ?? null,
      replicationLag,
      version: live?.version ?? null,
      live,
      x: 0,
      y: 0,
    }
  })

  // ── 2. build clusters with per-node shard/replica role ──
  const clusterNames: string[] = []
  const clusterMembers = new Map<
    string,
    Record<string, { s: number; r: number }>
  >()
  const clusterShards = new Map<string, Set<number>>()
  const clusterReplicas = new Map<string, Set<number>>()
  const clusterReplicatedDb = new Map<string, boolean>()

  for (const r of clusterRows) {
    const id = idByCanonKey.get(canonKey(r))
    if (!id) continue
    if (!clusterMembers.has(r.cluster)) {
      clusterNames.push(r.cluster)
      clusterMembers.set(r.cluster, {})
      clusterShards.set(r.cluster, new Set())
      clusterReplicas.set(r.cluster, new Set())
      clusterReplicatedDb.set(r.cluster, false)
    }
    clusterMembers.get(r.cluster)![id] = {
      s: num(r.shard_num),
      r: num(r.replica_num),
    }
    clusterShards.get(r.cluster)!.add(num(r.shard_num))
    clusterReplicas.get(r.cluster)!.add(num(r.replica_num))
    if (isReplicatedDbRow(r)) clusterReplicatedDb.set(r.cluster, true)
  }

  let paletteIdx = 0
  const clusters: ClusterInfo[] = clusterNames.map((name) => {
    const members = clusterMembers.get(name)!
    const shards = clusterShards.get(name)!.size
    // A Replicated-DB cluster is always logical regardless of name; otherwise
    // fall back to the name heuristic.
    const physical = !clusterReplicatedDb.get(name) && isPhysicalName(name)
    // replicas-per-shard: max replica_num seen
    const maxR = Math.max(...clusterReplicas.get(name)!, 1)
    // Every cluster gets its own palette color (physical included) so nested
    // rings stay distinguishable; the physical/logical split is conveyed by the
    // toggle + a softer fill, not by a flat gray.
    const color = CLUSTER_PALETTE[paletteIdx++ % CLUSTER_PALETTE.length]
    return {
      id: name,
      name,
      kind: physical ? 'physical' : 'logical',
      color,
      topo: `${shards} shard${shards === 1 ? '' : 's'} × ${maxR} replica${maxR === 1 ? '' : 's'}`,
      members,
      outline: physical,
      nodeCount: Object.keys(members).length,
      replicated: maxR > 1,
    }
  })

  // attach default-cluster role to each CH node for the inspector identity row
  const defaultCluster =
    clusters.find((c) => c.name === 'default') ??
    clusters.find((c) => c.outline)
  if (defaultCluster) {
    for (const n of chNodes) {
      const role = defaultCluster.members[n.id]
      if (role) n.defaultRole = role
    }
  }

  // ── 3. keepers ──
  const presenceClean = presenceRows.filter((r) => r?.host)
  const keeperRowsClean = keeperRows.filter((r) => r?.host)
  const source = detectKeeperSource(keeperRowsClean, presenceClean)

  // Prefer the rich keeper-info rows. When absent but presence rows exist (e.g.
  // ClickHouse < 26.1, or external ZooKeeper), synthesize nodes from presence
  // rows with role 'unknown' and null raft indices — never fabricate roles.
  const hasInfo = keeperRowsClean.length > 0
  const keepers: KeeperNode[] = hasInfo
    ? keeperRowsClean.map((r, i) => {
        const isLeader = truthy(r.is_leader)
        const connected =
          r.is_connected === undefined ? true : truthy(r.is_connected)
        const role = deriveKeeperRole(
          isLeader,
          r.server_state,
          keeperRowsClean.length
        )
        return {
          id: shortId(r.host, i) || `kpr-${i + 1}`,
          host: r.host,
          port: num(r.port, 9181),
          role,
          isLeader,
          version: r.version ?? '—',
          avgLatency: num(r.avg_latency),
          znodeCount: num(r.znode_count),
          watchCount: num(r.watch_count),
          outstanding: num(r.outstanding_requests),
          isConnected: connected,
          clusterName: r.zookeeper_cluster_name ?? 'keeper',
          x: 0,
          y: 0,
        }
      })
    : presenceClean.map((r, i) => ({
        id: shortId(r.host!, i) || `kpr-${i + 1}`,
        host: r.host!,
        port: num(r.port, source === 'zookeeper' ? 2181 : 9181),
        role: 'unknown' as KeeperRole,
        isLeader: false,
        version: '—',
        avgLatency: 0,
        znodeCount: 0,
        watchCount: 0,
        outstanding: 0,
        // is_expired=1 means a degraded/dropped session.
        isConnected: !truthy(r.is_expired),
        clusterName: r.name ?? source,
        x: 0,
        y: 0,
      }))

  const hasExplicitLeader = keepers.some((k) => k.isLeader)
  // Prefer the explicit leader; if none is reported on a single standalone node,
  // anchor on it; multi-node with no leader → null (election / split-brain).
  const leaderId =
    keepers.find((k) => k.isLeader)?.id ??
    (hasExplicitLeader
      ? null
      : keepers.length === 1
        ? (keepers[0]?.id ?? null)
        : null)
  // Voting members exclude observers/learners.
  const voters = keepers.filter((k) => k.role !== 'observer')
  const quorumHealthy =
    keepers.length > 0 &&
    keepers.every((k) => k.isConnected) &&
    (voters.some((k) => k.isLeader) ||
      (voters.length === 1 && voters[0].role === 'standalone'))

  // ── 4. edges ──
  // Raft: full mesh among VOTING keepers (small N); observers link to the leader only.
  const raftEdges: [string, string][] = []
  for (let i = 0; i < voters.length; i++) {
    for (let j = i + 1; j < voters.length; j++) {
      raftEdges.push([voters[i].id, voters[j].id])
    }
  }
  if (leaderId) {
    for (const k of keepers) {
      if (k.role === 'observer') raftEdges.push([leaderId, k.id])
    }
  }
  // Coordination: every CH node ↔ keeper leader (dashed).
  const coordEdges: [string, string][] =
    leaderId && keepers.length > 0
      ? chNodes.map((n) => [n.id, leaderId] as [string, string])
      : []
  // Replication: only for REPLICATED clusters. Within each shard, link
  // consecutive replicas. Sharded/distributed clusters get no inter-shard edges.
  const replSet = new Set<string>()
  const replEdges: [string, string][] = []
  for (const c of clusters) {
    if (!c.replicated) continue
    const byShard = new Map<number, string[]>()
    for (const [id, role] of Object.entries(c.members)) {
      if (!byShard.has(role.s)) byShard.set(role.s, [])
      byShard.get(role.s)!.push(id)
    }
    for (const ids of byShard.values()) {
      for (let i = 0; i < ids.length - 1; i++) {
        const a = ids[i]
        const b = ids[i + 1]
        const key = [a, b].sort().join('~')
        if (a !== b && !replSet.has(key)) {
          replSet.add(key)
          replEdges.push([a, b])
        }
      }
    }
  }

  return {
    keepers,
    chNodes,
    clusters,
    raftEdges,
    replEdges,
    coordEdges,
    keeper: {
      present: source !== 'none',
      source,
      leaderId,
      quorumHealthy,
    },
    meta: {
      counts: {
        nodes: keepers.length + chNodes.length,
        keepers: keepers.length,
        chNodes: chNodes.length,
        clusters: clusters.length,
        physical: clusters.filter((c) => c.kind === 'physical').length,
        logical: clusters.filter((c) => c.kind === 'logical').length,
      },
      truncated: false,
      hiddenChNodes: 0,
      liveSource,
    },
  }
}

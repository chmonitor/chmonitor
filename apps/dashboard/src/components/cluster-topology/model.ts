/**
 * Cluster topology data model — types + public surface.
 *
 * The actual implementation is split across three siblings so this file stays
 * a readable table of contents (see docs/knowledge/cluster-topology.md):
 *
 *  - `model-constants.ts` — layout constants / geometry envelopes / palettes.
 *  - `model-parse.ts` — row coercion + node-identity heuristics.
 *  - `model-assemble.ts` — `assembleTopology`: raw rows → layout-free `TopologyData`.
 *  - `model-layout.ts` — `layoutTopology` / `buildTopologyModel` + node placement.
 *  - `model-hulls.ts` — cluster territory + keeper-region overlay geometry.
 *
 * This module re-exports everything from the three so no import site needs to
 * change: `import { ... } from './model'` keeps working exactly as before.
 */

export interface NodeLiveMetrics {
  cpuPct: number | null
  memUsed: number | null
  memTotal: number | null
  memAvailable: number | null
  diskUsed: number | null
  diskTotal: number | null
  activeQueries: number | null
  uptimeSeconds: number | null
  version: string | null
}

export type KeeperRole =
  | 'leader'
  | 'follower'
  | 'observer'
  | 'standalone'
  | 'unknown'

export interface KeeperNode {
  id: string
  host: string
  port: number
  role: KeeperRole
  isLeader: boolean
  version: string
  avgLatency: number
  znodeCount: number
  watchCount: number
  outstanding: number
  isConnected: boolean
  clusterName: string
  x: number
  y: number
}

export type ChStatus = 'healthy' | 'warn' | 'down' | 'unreachable'

export interface ChNode {
  id: string
  host: string
  address: string
  port: number
  isLocal: boolean
  /** healthy | warn | down | unreachable — derived from errors/active/live, never random */
  status: ChStatus
  errors: number
  slowdowns: number
  recoveryTime: number
  isActive: number | null
  /** Replicated-DB replica lag (24.10+), null otherwise */
  replicationLag: number | null
  /** ClickHouse version, from the live fan-out (null when not reachable) */
  version: string | null
  /** live metrics for this node (null fields when not reachable / not permitted) */
  live: NodeLiveMetrics | null
  /** default-cluster shard/replica role, if present */
  defaultRole?: { s: number; r: number }
  x: number
  y: number
}

export interface ClusterInfo {
  id: string
  name: string
  kind: 'physical' | 'logical'
  color: string
  topo: string
  /** members keyed by node id → shard/replica role */
  members: Record<string, { s: number; r: number }>
  /** rendered as a dotted outline (physical default cluster) instead of a filled hull */
  outline: boolean
  nodeCount: number
  /** true when any shard has >1 replica → draw replication edges between replicas. */
  replicated: boolean
}

/**
 * Precomputed cluster overlay: an offset-convex-hull path plus the metadata the
 * canvas needs to draw it (color, border style, area for z-ordering, label
 * anchor). Pure function of structure + layout → stable across live ticks.
 */
export interface ClusterHull {
  id: string
  name: string
  color: string
  /** physical cluster → dotted outline (no fill); logical/virtual → dashed border + fill. */
  outline: boolean
  /** the single closed SVG path (circle / stadium / rounded polygon). */
  d: string
  /** Minkowski-sum area, used to z-order: largest drawn first (behind). */
  area: number
  /** Axis-aligned box of the territory (same as path bounds). Used to clamp
   * drag so nodes stay inside their cluster box, and to decide which nested
   * ring gets the single outer stroke (no overlapping borders). */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Stable signature of the rendered member set — coincident clusters share one. */
  memberSig: string
  /** Nest rank within a coincident group (0 = outermost / largest). */
  nestRank: number
  /** resolved label position (may be nudged off the rect to de-overlap). */
  labelX: number
  labelY: number
  /** the rect's true top-center, where a leader line points back to. */
  anchorX: number
  anchorY: number
  /** draw a thin connector from the label to the anchor (label was moved away). */
  leader: boolean
}

export type KeeperSource = 'keeper' | 'zookeeper' | 'none'

export interface KeeperSummary {
  present: boolean
  source: KeeperSource
  leaderId: string | null
  quorumHealthy: boolean
}

export interface TopologyMeta {
  counts: {
    nodes: number
    keepers: number
    chNodes: number
    clusters: number
    physical: number
    logical: number
  }
  /** true when the node list was capped for rendering (large clusters) */
  truncated: boolean
  /** number of CH nodes hidden by the render cap */
  hiddenChNodes: number
  /** how the live snapshot was obtained: full fan-out, local-only fallback, or none */
  liveSource: 'fanout' | 'local' | 'none'
}

/** Layout-free structural model — the server-route wire shape. */
export interface TopologyData {
  keepers: KeeperNode[]
  chNodes: ChNode[]
  clusters: ClusterInfo[]
  raftEdges: [string, string][]
  replEdges: [string, string][]
  coordEdges: [string, string][]
  keeper: KeeperSummary
  meta: TopologyMeta
}

export interface TopologyModel extends TopologyData {
  nodeById: Record<string, KeeperNode | ChNode>
  clusterById: Record<string, ClusterInfo>
  /** cluster overlays, sorted by area DESCENDING (largest first / behind). */
  clusterHulls: ClusterHull[]
  keeperHull: string
  /** mirror of keeper.leaderId for existing consumers */
  leaderId: string | null
  /** mirror of keeper.quorumHealthy for existing consumers */
  quorumHealthy: boolean
  counts: TopologyMeta['counts']
  /** viewBox height the canvas should use — DATA-DRIVEN: grows to fit the keeper
   * region, the CH band, and the deepest cluster-ring nesting + bottom pills for
   * THIS model, never below `VB_H`. A simple graph stays compact (big glyphs); a
   * deeply-nested one grows taller and letterboxes. Width is always `VB_W`. */
  vbHeight: number
}

/**
 * For very large clusters the rendered CH-node set is capped (the local node is
 * always kept) so the fixed viewBox stays readable; meta.truncated /
 * meta.hiddenChNodes report what was hidden. Edges referencing hidden nodes are
 * dropped by the canvas (it skips edges whose endpoints are missing).
 */
export interface LayoutOptions {
  /** Whether physical/implicit (outline) clusters are drawn. Default true. When
   * false they are dropped from the hulls AND the height reserve — they are the
   * OUTERMOST concentric rings, so hiding them lets the viewBox shrink. CH node
   * positions are driven only by LOGICAL clusters, so toggling never moves a
   * node — only the outer rings appear/disappear and the height adjusts. */
  showPhysical?: boolean
}

export * from './model-assemble'
export * from './model-constants'
export * from './model-hulls'
export * from './model-layout'
export * from './model-parse'

/**
 * Deterministic x/y layout pipeline: turns a layout-free `TopologyData` (from
 * `model-assemble.ts`) into the `TopologyModel` the SVG canvas + inspector
 * render. Pure & stable across live-metric ticks — no `Math.random` /
 * `Date.now`. See docs/knowledge/cluster-topology.md for the pipeline order
 * (`layoutKeepers` → `layoutChNodes` → `enforceMinDistance` → `clampToBand` →
 * `fitContent` → hull building) and the constant contracts.
 *
 * `buildTopologyModel(...)` composes `assembleTopology` + `layoutTopology` for
 * callers holding raw rows (the client fallback when the API route is
 * unavailable).
 */

import type { ClusterTopologyRow } from '@/lib/query-config/system/clusters-topology'
import type {
  ChNode,
  ClusterInfo,
  KeeperNode,
  LayoutOptions,
  TopologyData,
  TopologyMeta,
  TopologyModel,
} from './model'
import type {
  ClusterLiveRow,
  KeeperInfoRow,
  KeeperPresenceRow,
} from './model-assemble'

import { assembleTopology } from './model-assemble'
import {
  CH_R,
  CH_RENDER_CAP,
  chDownExtent,
  chHalfExtent,
  chUpExtent,
  ENVELOPE_MARGIN,
  KP_R,
  keeperDownExtent,
  keeperHalfExtent,
  keeperUpExtent,
  VB_H,
  VB_W,
} from './model-constants'
import {
  buildClusterHulls,
  buildKeeperRect,
  KEEPER_CLUSTER_GAP,
  NEST_STEP,
  PILL_ROW_H,
} from './model-hulls'

/**
 * Add deterministic x/y layout + lookup maps + hull to a TopologyData, producing
 * the model the SVG canvas + inspector consume. Pure & stable across live ticks.
 *
 * For very large clusters the rendered CH-node set is capped (the local node is
 * always kept) so the fixed viewBox stays readable; meta.truncated /
 * meta.hiddenChNodes report what was hidden. Edges referencing hidden nodes are
 * dropped by the canvas (it skips edges whose endpoints are missing).
 */
export function layoutTopology(
  data: TopologyData,
  { showPhysical = true }: LayoutOptions = {}
): TopologyModel {
  // Render cap: keep the local node + the first CH_RENDER_CAP nodes.
  let chNodes = data.chNodes
  let truncated = data.meta.truncated
  let hiddenChNodes = data.meta.hiddenChNodes
  if (chNodes.length > CH_RENDER_CAP) {
    const local = chNodes.filter((n) => n.isLocal)
    const rest = chNodes.filter((n) => !n.isLocal)
    const keepCount = Math.max(0, CH_RENDER_CAP - local.length)
    chNodes = [...local, ...rest.slice(0, keepCount)]
    truncated = true
    hiddenChNodes = data.chNodes.length - chNodes.length
  }

  // Clone so layout mutation does not affect the source data.
  const keepers = data.keepers.map((k) => ({ ...k }))
  const renderCh = chNodes.map((n) => ({ ...n }))

  // Visible cluster territories. Node LAYOUT always uses the full set (positions
  // are logical-cluster-driven, so this is a no-op there), but hull building and
  // the height reserve drop physical/outline clusters when they are toggled off.
  const visibleClusters = showPhysical
    ? data.clusters
    : data.clusters.filter((c) => !c.outline)

  layoutKeepers(keepers)
  layoutChNodes(renderCh, data.clusters)

  // Prevent overlap: push apart any nodes closer than the minimum spacing.
  // Wide gaps so a single-node cluster boundary can't reach a neighbor glyph
  // and labels never collide.
  enforceMinDistance(keepers, KP_R * 2 + 48)
  enforceMinDistance(renderCh, CH_R * 2 + 92)

  // Re-clamp after collision avoidance (repulsion can push nodes outside bounds).
  clampToBand(renderCh)

  // Auto-layout: translate the whole composition so its content (every node +
  // its labels) is centered in the draw area. This handles the no-keeper case
  // and any sparse layout — content sits in the middle instead of a fixed band.
  // Cluster RECTS outset past the node envelopes (margin + concentric NEST_STEP
  // rings) and the name pills sit on the bottom edge, so reserve that room or a
  // densely-nested graph spills below the viewBox.
  const { padTop, padBottom } = boundaryReserve(visibleClusters, chNodes)
  const vbHeight = fitContent(keepers, renderCh, padTop, padBottom)

  const nodeById: Record<string, KeeperNode | ChNode> = {}
  keepers.forEach((k) => {
    nodeById[k.id] = k
  })
  renderCh.forEach((n) => {
    nodeById[n.id] = n
  })
  const clusterById: Record<string, ClusterInfo> = {}
  data.clusters.forEach((c) => {
    clusterById[c.id] = c
  })

  const renderedIds = new Set(renderCh.map((n) => n.id))

  // Ceiling that keeps CH cluster boxes BELOW the keeper region: the lowest point
  // any keeper glyph + its label reaches, plus a gap. Computed from the FINAL
  // (post-centerContent) keeper positions so it matches the node coords the hulls
  // are built from. Null when there are no keepers (nothing to clear).
  const clusterTopCeiling = keepers.length
    ? Math.max(...keepers.map((k) => k.y + keeperDownExtent(k))) +
      KEEPER_CLUSTER_GAP
    : null

  // Cluster overlays: offset convex hulls, z-ordered by area DESC, label-nudged.
  const clusterHulls = buildClusterHulls(
    visibleClusters,
    nodeById,
    renderedIds,
    clusterTopCeiling
  )

  // Keeper quorum region over VOTING keepers (observers excluded): a rounded
  // rectangle whose envelope encloses every keeper glyph + its label. Absent → ''.
  const voters = keepers.filter((k) => k.role !== 'observer')
  const keeperHull = voters.length >= 1 ? buildKeeperRect(voters) : ''

  return {
    ...data,
    keepers,
    chNodes: renderCh,
    nodeById,
    clusterById,
    raftEdges: data.raftEdges,
    replEdges: data.replEdges,
    coordEdges: data.coordEdges,
    clusterHulls,
    keeperHull,
    leaderId: data.keeper.leaderId,
    quorumHealthy: data.keeper.quorumHealthy,
    counts: data.meta.counts,
    vbHeight,
    meta: { ...data.meta, truncated, hiddenChNodes },
  }
}

/**
 * Compose assemble + layout for callers holding raw rows (client fallback when
 * the API route is unavailable). Live metrics default to none.
 */
export function buildTopologyModel(
  clusterRows: ClusterTopologyRow[],
  keeperRows: KeeperInfoRow[],
  presenceRows: KeeperPresenceRow[] = [],
  liveRows: ClusterLiveRow[] = [],
  liveSource: TopologyMeta['liveSource'] = 'none',
  opts?: LayoutOptions
): TopologyModel {
  return layoutTopology(
    assembleTopology(
      clusterRows,
      keeperRows,
      presenceRows,
      liveRows,
      liveSource
    ),
    opts
  )
}

/** Keeper quorum: a horizontal triangle near the top (leader centered above). */
function layoutKeepers(keepers: KeeperNode[]) {
  const n = keepers.length
  if (n === 0) return
  const cx = VB_W / 2
  if (n === 1) {
    keepers[0].x = cx
    keepers[0].y = 120
    return
  }
  // leader on top apex, followers spread on a lower row.
  // When no keeper has been elected leader (findIndex === -1), don't crown
  // keepers[0] as the visual apex — keep a sensible default layout (keepers[0]
  // sits on top) but the apex node is NOT labeled leader (it has isLeader=false),
  // so nothing is falsely presented as the elected leader.
  const rawIdx = keepers.findIndex((k) => k.isLeader)
  const leaderIdx = rawIdx === -1 ? 0 : rawIdx
  const followers = keepers.filter((_, i) => i !== leaderIdx)
  keepers[leaderIdx].x = cx
  keepers[leaderIdx].y = 100
  // Spread followers wide enough that adjacent FQDN host labels (~166px when
  // truncated to ~24 chars) never overlap — the glyph gap alone is not enough —
  // but cap the row to the usable width so large ensembles (7+ keepers) stay in
  // the viewBox. centerContent can only clamp one side, so an over-wide row
  // would leave the end keeper + its label off-canvas.
  const desired = Math.min(280, 188 + followers.length * 16)
  const spread =
    followers.length > 1
      ? Math.min(desired, (VB_W - 2 * CH_MARGIN) / (followers.length - 1))
      : desired
  const total = (followers.length - 1) * spread
  // Sit the follower row below the leader's own label block (host + sub-line)
  // so the leader's text never grazes the follower glyphs.
  followers.forEach((f, i) => {
    f.x = cx - total / 2 + i * spread
    f.y = 214
  })
}

// CH region: a band below the keepers. Layout is deterministic + seeded only by
// structure so positions are stable across live ticks. The band leaves headroom
// below for each node's two label lines + LOCAL badge (≈ CH_R + 46). Sits low
// enough that keeper follower FQDN labels clear the CH cards + the topmost
// (outermost concentric) cluster boundary — see `KEEPER_CLUSTER_GAP`.
const CH_BAND_Y = 392
const CH_BAND_H = 120
const CH_MARGIN = 170

/**
 * ClickHouse node layout that makes overlapping clusters legible:
 *  - group nodes by which DRAWABLE (logical/virtual) clusters they belong to;
 *  - give each logical cluster a centroid slot along a horizontal band;
 *  - place a node at the AVERAGE of its clusters' centroids, so a host shared by
 *    two clusters lands on the boundary between them → their hulls intersect in
 *    a small intentional lens (the ch-03 story);
 *  - spread nodes inside the same group on a compact grid so glyphs don't stack.
 *
 * Falls back to the simple centered arc / multi-row grid when there are no
 * logical clusters (e.g. only the implicit `default` cluster).
 */
function layoutChNodes(nodes: ChNode[], clusters: ClusterInfo[]) {
  const n = nodes.length
  if (n === 0) return
  const cx = VB_W / 2
  if (n === 1) {
    nodes[0].x = cx
    nodes[0].y = CH_BAND_Y + CH_BAND_H / 2
    return
  }

  // Drawable clusters = logical/virtual (filled hulls). Physical/outline clusters
  // span everything, so they don't drive grouping.
  const ids = new Set(nodes.map((nd) => nd.id))
  const logical = clusters
    .filter((c) => !c.outline)
    .filter((c) => Object.keys(c.members).some((id) => ids.has(id)))

  if (logical.length === 0) {
    layoutArc(nodes, cx)
    return
  }

  // Centroid slot per logical cluster, evenly spread along the band.
  const slotY = CH_BAND_Y + CH_BAND_H / 2
  const usable = VB_W - 2 * CH_MARGIN
  const centroid = new Map<string, { x: number; y: number }>()
  logical.forEach((c, i) => {
    const t = logical.length === 1 ? 0.5 : i / (logical.length - 1)
    centroid.set(c.id, { x: CH_MARGIN + t * usable, y: slotY })
  })

  // Membership of each node among logical clusters (deterministic order).
  const memberClusters = (id: string) =>
    logical.filter((c) => c.members[id]).map((c) => c.id)

  // Group nodes by membership signature; place the whole group near the average
  // of its clusters' centroids (boundary for shared nodes), then fan out.
  const groups = new Map<string, ChNode[]>()
  for (const nd of nodes) {
    const mc = memberClusters(nd.id)
    const sig = mc.length ? mc.join('|') : '__none__'
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(nd)
  }

  // Stable group order: by signature string.
  const sigOrder = [...groups.keys()].sort()
  for (const sig of sigOrder) {
    const members = groups.get(sig)!
    const mc = sig === '__none__' ? [] : sig.split('|')
    let gx = cx
    let gy = slotY
    if (mc.length > 0) {
      gx = mc.reduce((s, id) => s + (centroid.get(id)?.x ?? cx), 0) / mc.length
      gy =
        mc.reduce((s, id) => s + (centroid.get(id)?.y ?? slotY), 0) / mc.length
      // Shared nodes (≥2 clusters) sit slightly higher so the lens reads cleanly.
      if (mc.length >= 2) gy -= 30
    }
    fanOut(members, gx, gy)
  }

  clampToBand(nodes)
}

/** Spread `members` on a compact centered grid around (gx, gy). Deterministic.
 * Row/col steps shrink for large groups so the grid stays inside the band. */
function fanOut(members: ChNode[], gx: number, gy: number) {
  const k = members.length
  if (k === 1) {
    members[0].x = gx
    members[0].y = gy
    return
  }
  // Prefer a WIDE grid (more columns, fewer rows) — the canvas has width to
  // spare and tall stacks overlap. Small groups stay on a single row; even a
  // capped 24-node cluster needs only ~3 rows.
  const cols =
    k <= 5
      ? k
      : Math.min(k, Math.max(Math.ceil(Math.sqrt(k)), Math.ceil(k / 3)))
  const rows = Math.ceil(k / cols)
  const stepY = Math.min(132, rows > 1 ? CH_BAND_H / (rows - 1) : 132)
  const stepX = Math.min(160, Math.max(108, stepY))
  // Zigzag: alternate columns sit half a stagger above/below the row line so
  // adjacent nodes are never on the same horizontal line — their labels can't
  // collide even when the group is squeezed near a margin.
  const STAGGER = 46
  members.forEach((nd, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const rowCount = Math.min(cols, k - row * cols)
    const rowOffset = ((rowCount - 1) * stepX) / 2
    const zig = cols > 1 ? (col % 2 === 0 ? -STAGGER / 2 : STAGGER / 2) : 0
    nd.x = gx - rowOffset + col * stepX
    nd.y = gy + row * stepY - ((rows - 1) * stepY) / 2 + zig
  })
}

/** Simple centered arc / multi-row grid (no logical clusters). Rows are packed
 * into the readable band so even a capped-large N stays inside the viewBox. */
function layoutArc(nodes: ChNode[], cx: number) {
  const n = nodes.length
  const usable = VB_W - 2 * CH_MARGIN
  const perRow = Math.min(n, Math.max(1, Math.floor(usable / 150) + 1))
  const rows = Math.ceil(n / perRow)
  if (rows <= 1) {
    const baseY = CH_BAND_Y + CH_BAND_H / 2
    const step = n > 1 ? Math.min(220, usable / (n - 1)) : 0
    const total = (n - 1) * step
    nodes.forEach((node, i) => {
      node.x = cx - total / 2 + i * step
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
      node.y = baseY + Math.round((1 - t * t) * 34)
    })
    return
  }
  const rowStep = Math.min(120, CH_BAND_H / Math.max(1, rows - 1))
  const top = CH_BAND_Y
  nodes.forEach((node, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const inRow = Math.min(perRow, n - row * perRow)
    const step = inRow > 1 ? Math.min(160, usable / (inRow - 1)) : 0
    const total = (inRow - 1) * step
    node.x = cx - total / 2 + col * step
    node.y = top + row * rowStep
  })
}

/** Keep nodes inside the readable band + horizontal margins. */
function clampToBand(nodes: ChNode[]) {
  for (const nd of nodes) {
    nd.x = Math.max(CH_MARGIN, Math.min(VB_W - CH_MARGIN, nd.x))
    nd.y = Math.max(CH_BAND_Y - 10, Math.min(CH_BAND_Y + CH_BAND_H, nd.y))
  }
}

/**
 * Translate the whole composition (keepers + CH nodes) so the bounding box of
 * its CONTENT envelopes is centered in the draw area. Keeps relative positions
 * intact; offset is clamped so content never leaves the viewBox when it fits.
 * This is the "auto layout" — sparse graphs (no keeper, one node) sit centered
 * instead of stuck in a fixed band.
 */
/**
 * Vertical room the cluster boundary rects + their bottom pills occupy BEYOND the
 * node envelopes, so `centerContent` can keep the whole composition in view.
 * Coincident logical clusters (same rendered member set) nest as concentric
 * rings stepped by `NEST_STEP`; distinct ones get the small expand-only jitter.
 * Name pills sit on the bottom edge → bottom needs an extra pill's worth.
 */
function boundaryReserve(
  clusters: ClusterInfo[],
  chNodes: ChNode[]
): { padTop: number; padBottom: number } {
  const ids = new Set(chNodes.map((n) => n.id))
  // Count EVERY cluster that produces a hull (outline ones too — they are now
  // labelled and nest as concentric rings exactly like logical ones), matching
  // `buildClusterHulls`'s coincident grouping so the reserve never undercounts.
  const drawn = clusters.filter((c) =>
    Object.keys(c.members).some((id) => ids.has(id))
  )
  if (drawn.length === 0) return { padTop: 0, padBottom: 0 }
  const sig = (c: ClusterInfo) =>
    Object.keys(c.members)
      .filter((id) => ids.has(id))
      .sort()
      .join(',')
  const groupSize = new Map<string, number>()
  for (const c of drawn) {
    const s = sig(c)
    groupSize.set(s, (groupSize.get(s) ?? 0) + 1)
  }
  const maxNest = Math.max(...groupSize.values())
  // Outermost-ring outset for the deepest nest, else the distinct-rect jitter.
  const ring = Math.max((maxNest - 1) * NEST_STEP, 21)
  const pad = ring + ENVELOPE_MARGIN
  // Bottom pills can stack DOWNWARD by a PILL_ROW per horizontally-overlapping
  // distinct cluster (coincident clusters nest as rings instead, so count member
  // SETS, not clusters). Reserve a few rows so a busy graph's lowest pill stays
  // in view; capped because spread-out pills rarely all share one x-column.
  const stackRows = Math.min(groupSize.size, 3)
  return { padTop: pad, padBottom: pad + stackRows * PILL_ROW_H + 8 }
}

// Symmetric margin between the content bounding box and the viewBox edges when
// the viewBox grows to fit. Keeps the territory rings off the very edge.
const FIT_MARGIN = 20

/**
 * Center the composition horizontally in `VB_W` and compute a DATA-DRIVEN viewBox
 * height that exactly fits the content (keeper region + CH band + the deepest
 * cluster-ring outset and bottom pills, via `padTop`/`padBottom`), never below
 * `VB_H`. Content is then centered vertically within that height. Returns the
 * height for the canvas to use. Mutates node x/y in place. Deterministic.
 */
function fitContent(
  keepers: KeeperNode[],
  chNodes: ChNode[],
  padTop = 0,
  padBottom = 0
): number {
  if (keepers.length === 0 && chNodes.length === 0) return VB_H
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const k of keepers) {
    minX = Math.min(minX, k.x - keeperHalfExtent())
    maxX = Math.max(maxX, k.x + keeperHalfExtent())
    minY = Math.min(minY, k.y - keeperUpExtent(k))
    maxY = Math.max(maxY, k.y + keeperDownExtent(k))
  }
  for (const c of chNodes) {
    minX = Math.min(minX, c.x - chHalfExtent())
    maxX = Math.max(maxX, c.x + chHalfExtent())
    minY = Math.min(minY, c.y - chUpExtent())
    maxY = Math.max(maxY, c.y + chDownExtent(c))
  }
  // Reserve room for the cluster boundary rects + their bottom pills, which sit
  // outside the node envelopes, so the fitted composition still encloses them.
  minY -= padTop
  maxY += padBottom

  // Height grows to fit content (+ margins), floored at VB_H so a sparse graph
  // stays compact and its glyphs render large.
  const vbHeight = Math.max(VB_H, Math.round(maxY - minY + 2 * FIT_MARGIN))

  let dx = (VB_W - minX - maxX) / 2
  const dy = (vbHeight - minY - maxY) / 2
  if (minX + dx < 0 || maxX + dx > VB_W) dx = Math.max(-minX, dx)
  for (const k of keepers) {
    k.x += dx
    k.y += dy
  }
  for (const c of chNodes) {
    c.x += dx
    c.y += dy
  }
  return vbHeight
}

/**
 * Push apart any nodes closer than `minDist` from each other.
 * Iterative repulsion — converges in a few passes for typical cluster sizes.
 */
function enforceMinDistance(
  nodes: { x: number; y: number }[],
  minDist: number
) {
  for (let iter = 0; iter < 12; iter++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x
        const dy = nodes[j].y - nodes[i].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < minDist) {
          const push = (minDist - dist) / 2 + 1
          if (dist > 1e-9) {
            const nx = dx / dist
            const ny = dy / dist
            nodes[i].x -= nx * push
            nodes[i].y -= ny * push
            nodes[j].x += nx * push
            nodes[j].y += ny * push
          } else {
            // Coincident — push apart at a spread angle.
            const angle = (Math.PI * 2 * (i + 1)) / nodes.length
            nodes[i].x -= Math.cos(angle) * (minDist / 2)
            nodes[i].y -= Math.sin(angle) * (minDist / 2)
            nodes[j].x += Math.cos(angle) * (minDist / 2)
            nodes[j].y += Math.sin(angle) * (minDist / 2)
          }
          moved = true
        }
      }
    }
    if (!moved) break
  }
}

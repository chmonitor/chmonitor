/**
 * Cluster territory + keeper-region overlay geometry.
 *
 * Turns rendered node positions (from `model-layout.ts`) into the rounded-rect
 * SVG paths + label-nudge metadata the canvas draws. Pure: depends only on
 * structure + layout, never live metrics. See docs/knowledge/cluster-topology.md
 * for the envelope/boundary contracts these functions rely on.
 */

import type {
  ChNode,
  ClusterHull,
  ClusterInfo,
  KeeperNode,
} from './model-types'

import { roundedRectPath } from './geometry'
import {
  chDownExtent,
  chHalfExtent,
  chUpExtent,
  ENVELOPE_MARGIN,
  keeperDownExtent,
  keeperHalfExtent,
  keeperUpExtent,
} from './model-constants'
import { isKeeperNode } from './model-parse'

// Corner radius for cluster rects: a single-node cluster reads as a soft squircle.
const CLUSTER_RECT_RADIUS = 54

// One stacked label-pill row (pill height 19 + a hair). Shared by `nudgeLabels`
// and `boundaryReserve` so the two never drift.
export const PILL_ROW_H = 21

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Keeper quorum region: a rounded rect whose envelope encloses every voting
 * keeper glyph + its star/label. Asymmetric (small top, room for the label). */
export function buildKeeperRect(voters: KeeperNode[]): string {
  const minX = Math.min(...voters.map((k) => k.x - keeperHalfExtent()))
  const maxX = Math.max(...voters.map((k) => k.x + keeperHalfExtent()))
  const minY = Math.min(...voters.map((k) => k.y - keeperUpExtent(k)))
  const maxY = Math.max(...voters.map((k) => k.y + keeperDownExtent(k)))
  const m = ENVELOPE_MARGIN
  return roundedRectPath(
    minX - m,
    minY - m,
    maxX - minX + 2 * m,
    maxY - minY + 2 * m,
    CLUSTER_RECT_RADIUS
  )
}

// Each coincident cluster (same member SET) grows by this much per nesting rank
// so the rects sit as concentric rings. Wide enough that adjacent strokes and
// their casings never overlap.
export const NEST_STEP = 30

// Minimum vertical gap between the keeper region and the TOP of any CH cluster
// boundary. `buildClusterHulls` clamps each rect's top edge to this ceiling so a
// keeper (not a CH-cluster member) always stays OUTSIDE the CH cluster boxes.
export const KEEPER_CLUSTER_GAP = 16

export function buildClusterHulls(
  clusters: ClusterInfo[],
  nodeById: Record<string, KeeperNode | ChNode>,
  renderedIds: Set<string>,
  topCeiling: number | null = null
): ClusterHull[] {
  // Group clusters by rendered-member SET; coincident clusters (e.g. implicit
  // all-*/default) become nested rings in a stable order.
  const memberSig = (cl: ClusterInfo): string =>
    Object.keys(cl.members)
      .filter((id) => renderedIds.has(id))
      .sort()
      .join(',')
  const sigCount = new Map<string, number>()
  for (const cl of clusters) {
    const sig = memberSig(cl)
    if (sig) sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1)
  }
  const sigRank = new Map<string, number>()

  const hulls: ClusterHull[] = []
  for (const cl of clusters) {
    const centers = Object.keys(cl.members)
      .filter((id) => renderedIds.has(id))
      .map((id) => nodeById[id])
      .filter(Boolean)
    if (centers.length === 0) continue
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const c of centers) {
      const down = isKeeperNode(c)
        ? keeperDownExtent(c)
        : chDownExtent(c as ChNode)
      minX = Math.min(minX, c.x - chHalfExtent())
      maxX = Math.max(maxX, c.x + chHalfExtent())
      minY = Math.min(minY, c.y - chUpExtent())
      maxY = Math.max(maxY, c.y + down)
    }
    // True top of member content; the top clamp must not rise above it.
    const contentMinY = minY
    const sig = memberSig(cl)
    const coincident = (sigCount.get(sig) ?? 0) > 1
    const rank = sigRank.get(sig) ?? 0
    sigRank.set(sig, rank + 1)
    // Coincident clusters: concentric outset, no jitter. Distinct clusters: tiny
    // expand-only jitter so overlapping rects don't share a collinear edge.
    const m = ENVELOPE_MARGIN
    if (coincident) {
      const out = rank * NEST_STEP
      minX -= m + out
      maxX += m + out
      minY -= m + out
      maxY += m + out
    } else {
      minX -= m + (hashStr(cl.id) % 4) * 7
      maxX += m + (hashStr(`${cl.id}~r`) % 4) * 7
      minY -= m + (hashStr(`${cl.id}~t`) % 4) * 7
      maxY += m + (hashStr(`${cl.id}~b`) % 4) * 7
    }
    // Clamp the top edge below the keeper region so the outer ring can't engulf a
    // keeper. `Math.min(topCeiling, contentMinY)` keeps it from clipping a node's own box.
    if (topCeiling != null) {
      minY = Math.max(minY, Math.min(topCeiling, contentMinY))
    }
    const w = maxX - minX
    const h = maxY - minY
    const d = roundedRectPath(minX, minY, w, h, CLUSTER_RECT_RADIUS)
    if (!d) continue
    const cx = (minX + maxX) / 2
    // Anchor the label to the BOTTOM edge: the top edge is crowded under the
    // keeper region, where pills get hidden or overlap node sub-lines.
    hulls.push({
      id: cl.id,
      name: cl.name,
      color: cl.color,
      outline: cl.outline,
      d,
      area: w * h,
      minX,
      minY,
      maxX,
      maxY,
      memberSig: sig,
      nestRank: rank,
      labelX: cx,
      labelY: maxY,
      anchorX: cx,
      anchorY: maxY,
      leader: false,
    })
  }
  // Largest first (drawn behind). Tie-break by id for determinism.
  hulls.sort((a, b) => b.area - a.area || a.id.localeCompare(b.id))
  // Renumber nestRank so 0 = outermost; the canvas strokes only rank 0.
  const bySig = new Map<string, ClusterHull[]>()
  for (const h of hulls) {
    const list = bySig.get(h.memberSig) ?? []
    list.push(h)
    bySig.set(h.memberSig, list)
  }
  for (const list of bySig.values()) {
    list.sort((a, b) => b.area - a.area || a.id.localeCompare(b.id))
    list.forEach((h, i) => {
      h.nestRank = i
    })
  }
  nudgeLabels(hulls)
  return hulls
}

/**
 * De-overlap cluster label pills: anchored to each rect's bottom edge, stacked
 * downward on collision (half-width estimated from character count, matching
 * `HullLabel`'s `text.length * 7 + 20`). A pill pushed away from its anchor is
 * flagged so the canvas draws a leader line.
 */
function nudgeLabels(hulls: ClusterHull[]) {
  const ROW_H = PILL_ROW_H
  const halfW = (h: ClusterHull) => (h.name.length * 7 + 20) / 2
  const sorted = [...hulls].sort(
    (a, b) => a.labelX - b.labelX || a.id.localeCompare(b.id)
  )
  const placed: ClusterHull[] = []
  for (const cur of sorted) {
    let y = cur.anchorY
    let moved = true
    let guard = 0
    while (moved && guard++ < 100) {
      moved = false
      for (const p of placed) {
        const overlapX = Math.abs(cur.labelX - p.labelX) < halfW(cur) + halfW(p)
        const overlapY = Math.abs(y - p.labelY) < ROW_H
        if (overlapX && overlapY) {
          y = p.labelY + ROW_H
          moved = true
        }
      }
    }
    cur.labelY = y
    // A pill dropped more than a row below its anchor reads as detached → leader.
    cur.leader = cur.labelY - cur.anchorY > ROW_H + 2
    placed.push(cur)
  }
}

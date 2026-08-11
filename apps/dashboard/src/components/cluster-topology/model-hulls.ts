/**
 * Cluster territory + keeper-region overlay geometry.
 *
 * Turns rendered node positions (from `model-layout.ts`) into the rounded-rect
 * SVG paths + label-nudge metadata the canvas draws. Pure: depends only on
 * structure + layout, never live metrics. See docs/knowledge/cluster-topology.md
 * for the envelope/boundary contracts these functions rely on.
 */

import type { ChNode, ClusterHull, ClusterInfo, KeeperNode } from './model'

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

// Corner radius for the cluster territory rectangles — round enough that a
// single-node cluster reads as a soft squircle, capped so it never over-rounds.
const CLUSTER_RECT_RADIUS = 54

// One stacked label-pill row (pill height 19 + a hair). Shared by `nudgeLabels`
// (the actual downward stacking) and `boundaryReserve` (the room reserved for
// it) so the two never drift.
export const PILL_ROW_H = 21

/** Stable string hash → non-negative int. Deterministic (layout is tested). */
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

/**
 * Build the cluster overlay paths from rendered member positions. Pure: depends
 * only on structure + layout, not live metrics. Each territory is a rounded
 * bounding RECTANGLE around its members' CONTENT envelope (glyph + labels) so
 * every node and its text sit INSIDE the boundary. A small expand-only jitter
 * offsets overlapping rects so two clusters read as distinct territories (no
 * collinear edges). Sorted by area DESC so the canvas draws the largest first.
 */
// Each coincident cluster (same member SET) is grown by this much per nesting
// rank so the rects sit as concentric rings instead of stacking invisibly — the
// "multiple clusters, same nodes" overlap case from the screenshot. Wide enough
// that each ring's stroke + its casing has clear air around it, so adjacent
// borders never visually overlap even with several coincident clusters.
export const NEST_STEP = 30

// Minimum vertical gap kept between the bottom of the keeper region and the TOP
// of any CH cluster boundary. `buildClusterHulls` clamps each rect's top edge to
// this ceiling so the outermost concentric ring can never climb into the keeper
// region — a keeper (which is NOT a CH-cluster member) always stays OUTSIDE the
// CH cluster boxes, no matter how deep the nesting. The clamp only trims the
// decorative outset band above the nodes; node envelopes sit well below it.
export const KEEPER_CLUSTER_GAP = 16

export function buildClusterHulls(
  clusters: ClusterInfo[],
  nodeById: Record<string, KeeperNode | ChNode>,
  renderedIds: Set<string>,
  topCeiling: number | null = null
): ClusterHull[] {
  // Group clusters by their rendered-member SET. Coincident clusters (the
  // implicit all-*/default clusters that all cover the same hosts) are drawn as
  // nested rings, ranked in a stable order so layout stays deterministic.
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
    // Content bounding box: each member's glyph + labels, so nothing spills out.
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
    // The true top of member CONTENT (before the decorative outset). The top
    // clamp must never rise above this, or it would clip a node's own box.
    const contentMinY = minY
    const sig = memberSig(cl)
    const coincident = (sigCount.get(sig) ?? 0) > 1
    const rank = sigRank.get(sig) ?? 0
    sigRank.set(sig, rank + 1)
    // Coincident clusters → concentric outset (deterministic, no jitter so the
    // rings stay clean). Distinct clusters → tiny expand-only jitter so two
    // genuinely-overlapping rects don't share a collinear edge.
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
    // Keep the box BELOW the keeper region: clamp the top edge to the ceiling so
    // the outermost concentric ring can't climb into the keeper region and engulf
    // a keeper (a non-member). Only trims the decorative outset band above the
    // members; guarded by `Math.min(topCeiling, contentMinY)` so it can never clip
    // a node's own box even when the keeper region extends below content's top.
    if (topCeiling != null) {
      minY = Math.max(minY, Math.min(topCeiling, contentMinY))
    }
    const w = maxX - minX
    const h = maxY - minY
    const d = roundedRectPath(minX, minY, w, h, CLUSTER_RECT_RADIUS)
    if (!d) continue
    const cx = (minX + maxX) / 2
    // Anchor the label to the rect's BOTTOM edge: the top edge sits in the
    // crowded zone just under the keeper region, where pills get hidden or
    // overlap node sub-lines. Below the cards is open space — pills stay clear.
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
  // Within each coincident group, renumber nestRank so 0 = outermost (largest
  // area). Canvas draws a stroke ONLY on rank 0 → no stacked/overlapping borders.
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
 * De-overlap cluster label pills so every name stays readable. Pills anchor to
 * each rect's BOTTOM edge and are stacked DOWNWARD when they would collide
 * (estimating each pill's half-width from its character count — matching
 * `HullLabel`'s `text.length * 7 + 20`). Any pill pushed away from its anchor is
 * flagged so the canvas draws a thin leader line back to the territory. The open
 * space below the cards means downward stacking never lands on a node.
 * Deterministic.
 */
function nudgeLabels(hulls: ClusterHull[]) {
  const ROW_H = PILL_ROW_H
  const halfW = (h: ClusterHull) => (h.name.length * 7 + 20) / 2
  // Place left→right; drop each pill below any already-placed pill it overlaps.
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

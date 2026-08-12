/**
 * Pure geometry for the topology canvas — zero React dependency.
 *
 * Split out of `topo-canvas.tsx` so these constants/helpers are unit-testable
 * in isolation (viewBox fitting, client↔SVG coordinate mapping, hull cage
 * lookup, and drag clamping). Imports types/constants directly from the
 * `model-*` siblings (never from `./model`, the barrel, and never from a
 * component file) so this module cannot reintroduce an import cycle — see
 * `model.ts`'s header comment for the cycle history.
 */
import type { ClusterHull, TopologyModel } from './model-types'

import { CH_R, KP_R, VB_W } from './model-constants'
import { isKeeperNode } from './model-parse'

// Conservative visual extents used for zoom-to-fit viewBox computation.
// These are upper bounds: they must be >= actual label extents so nothing clips.
// They intentionally match the contracts in model.ts (chDownExtent etc.) but as
// maximums rather than per-node values, which is fine for viewBox sizing.
//
//   _CH_HALF — chHalfExtent
//   _CH_UP   — chUpExtent
//   _CH_DOWN — chDownExtent worst case (local + FQDN + badge)
//   _KP_HALF — keeperHalfExtent
//   _KP_UP   — keeperUpExtent (leader star)
//   _KP_DOWN — keeperDownExtent worst case (FQDN host line)
export const _CH_HALF = CH_R + 34
export const _CH_UP = CH_R + 8
export const _CH_DOWN = CH_R + 57
export const _KP_HALF = KP_R + 16
export const _KP_UP = KP_R + 22
export const _KP_DOWN = KP_R + 42

// Extra room added around the node envelope bounding box to accommodate the
// outermost cluster hull rects (which outset ENVELOPE_MARGIN + rank*NEST_STEP
// past the node content) and cluster label pills below.
const HULL_EXTRA = 120

// Padding (in viewBox units) between the content box and the SVG viewport edge.
const FIT_PAD = 36

// Maximum zoom scale for sparse / single-node topologies. Prevents one node
// filling an entire large canvas (would look unbalanced and hard to read).
const MAX_SCALE = 1.5

// Minimum viewBox size in each dimension (viewBox units). Keeps single-node
// topologies from being blown up beyond MAX_SCALE even if the container is huge.
const MIN_VB_W = VB_W / MAX_SCALE
const MIN_VB_H = 320

// Inset from hull edges when clamping dragged nodes so the glyph + labels stay
// visually inside the box (matches half-extent / up / down envelopes).
const CLAMP_PAD_X = _CH_HALF
const CLAMP_PAD_Y_TOP = _CH_UP
const CLAMP_PAD_Y_BOT = CH_R + 36

export type Pos = { x: number; y: number }
export type PosMap = Record<string, Pos>

export type DragKind = 'node' | 'group'

export interface DragState {
  kind: DragKind
  /** Primary id (node id or cluster id). */
  id: string
  /** Node ids being moved. */
  nodeIds: string[]
  /** Pointer position in SVG space at drag start. */
  origin: Pos
  /** Positions of moved nodes at drag start (layout + prior offsets). */
  start: PosMap
  /** True once the pointer moved past the click threshold. */
  moved: boolean
  pointerId: number
}

export const CLICK_SLOP = 4 // px in SVG space before a press counts as a drag

/**
 * Compute a tight content-aware viewBox string from the model.
 * Starts from the bounding box of all node visual extents (glyph + labels),
 * expands by HULL_EXTRA to cover cluster boundary rects and label pills, adds
 * FIT_PAD breathing room, enforces minimum dimensions (to cap zoom), and clamps
 * to the full model extent so the viewBox never excludes any content.
 */
export function contentViewBox(
  model: TopologyModel,
  positions: PosMap
): string {
  const { keepers, chNodes, clusterHulls, vbHeight } = model
  if (keepers.length === 0 && chNodes.length === 0) {
    return `0 0 ${VB_W} ${vbHeight}`
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const k of keepers) {
    const p = positions[k.id] ?? k
    minX = Math.min(minX, p.x - _KP_HALF)
    maxX = Math.max(maxX, p.x + _KP_HALF)
    minY = Math.min(minY, p.y - _KP_UP)
    maxY = Math.max(maxY, p.y + _KP_DOWN)
  }
  for (const n of chNodes) {
    const p = positions[n.id] ?? n
    minX = Math.min(minX, p.x - _CH_HALF)
    maxX = Math.max(maxX, p.x + _CH_HALF)
    minY = Math.min(minY, p.y - _CH_UP)
    maxY = Math.max(maxY, p.y + _CH_DOWN)
  }
  for (const hull of clusterHulls) {
    maxY = Math.max(maxY, hull.labelY + 20)
  }
  minX -= HULL_EXTRA
  maxX += HULL_EXTRA
  minY -= HULL_EXTRA
  maxY += HULL_EXTRA

  minX -= FIT_PAD
  maxX += FIT_PAD
  minY -= FIT_PAD
  maxY += FIT_PAD

  let w = maxX - minX
  let h = maxY - minY

  if (w < MIN_VB_W) {
    const extra = (MIN_VB_W - w) / 2
    minX -= extra
    maxX += extra
    w = MIN_VB_W
  }
  if (h < MIN_VB_H) {
    const extra = (MIN_VB_H - h) / 2
    minY -= extra
    maxY += extra
    h = MIN_VB_H
  }

  minX = Math.max(minX, -FIT_PAD)
  minY = Math.max(minY, -FIT_PAD)
  maxX = Math.min(maxX, VB_W + FIT_PAD)
  maxY = Math.min(maxY, vbHeight + FIT_PAD)
  w = maxX - minX
  h = maxY - minY

  return `${Math.round(minX)} ${Math.round(minY)} ${Math.round(w)} ${Math.round(h)}`
}

export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): Pos {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** Tightest (smallest-area) hull that contains this node id as a member. */
export function cageForNode(
  model: TopologyModel,
  nodeId: string,
  preferClusterId?: string | null
): ClusterHull | null {
  const { clusterHulls, clusterById } = model
  if (preferClusterId && clusterById[preferClusterId]?.members[nodeId]) {
    const h = clusterHulls.find((x) => x.id === preferClusterId)
    if (h) return h
  }
  let best: ClusterHull | null = null
  for (const h of clusterHulls) {
    if (!clusterById[h.id]?.members[nodeId]) continue
    if (!best || h.area < best.area) best = h
  }
  return best
}

export function clampToHull(
  x: number,
  y: number,
  hull: ClusterHull | null
): Pos {
  if (!hull) return { x, y }
  const minX = hull.minX + CLAMP_PAD_X
  const maxX = hull.maxX - CLAMP_PAD_X
  const minY = hull.minY + CLAMP_PAD_Y_TOP
  const maxY = hull.maxY - CLAMP_PAD_Y_BOT
  // Degenerate / tiny boxes: fall back to center.
  if (minX > maxX || minY > maxY) {
    return {
      x: (hull.minX + hull.maxX) / 2,
      y: (hull.minY + hull.maxY) / 2,
    }
  }
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  }
}

/** Shared delta for a group drag, shrunk so every member stays in the box. */
export function groupSafeDelta(
  model: TopologyModel,
  d: DragState,
  rawDx: number,
  rawDy: number,
  preferClusterId: string | null
): Pos {
  let dx = rawDx
  let dy = rawDy
  const groupHull =
    d.kind === 'group'
      ? (model.clusterHulls.find((h) => h.id === d.id) ?? null)
      : null
  for (const nid of d.nodeIds) {
    const base = model.nodeById[nid]
    const s = d.start[nid]
    if (!base || !s || isKeeperNode(base)) continue
    const cage = groupHull ?? cageForNode(model, nid, preferClusterId)
    if (!cage) continue
    const want = { x: s.x + dx, y: s.y + dy }
    const got = clampToHull(want.x, want.y, cage)
    // Pull delta back if any member hit a wall.
    dx += got.x - want.x
    dy += got.y - want.y
  }
  return { x: dx, y: dy }
}

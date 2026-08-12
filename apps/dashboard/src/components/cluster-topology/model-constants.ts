/**
 * Layout constants + presentation palettes for the cluster topology model.
 *
 * See docs/knowledge/cluster-topology.md for the constant contracts — several
 * of these numbers form cross-file agreements with `topo-canvas.tsx` (label
 * positions) and `model-layout.ts` (envelope math). Do not change a number in
 * isolation; check the contract in the knowledge doc first.
 */

import type { ChNode, KeeperNode } from './model-types'

// Canvas viewBox. WIDE aspect so it fills the xl two-column container instead of
// letterboxing horizontally — the "relax the space" ask. The extra height leaves
// room for each node's labels to sit INSIDE its cluster boundary.
// Imported by the layout tests, so the in-viewBox bounds check moves with them.
export const VB_W = 1280
// MINIMUM viewBox height. The ACTUAL height is computed per-model (`vbHeight`,
// see `fitContent`) so it grows to fit the keeper region, the widened keeper↔CH
// gap (keepers sit fully OUTSIDE the CH cluster boxes), and deeply-nested cluster
// rings + their now-labelled bottom pills — and stays compact (this floor) for a
// simple graph so glyphs render large. The fixed-height container scales with
// preserveAspectRatio="meet", so a taller viewBox letterboxes instead of clipping.
export const VB_H = 560
// Node radii are exported so the canvas glyphs render at exactly the size the
// layout reserves spacing/hull padding for — no drift between layout and paint.
// Sized so a typical hostname fits INSIDE the glyph (square card / hexagon).
export const CH_R = 42
export const KP_R = 40

// Cap CH nodes drawn on the canvas so large clusters stay readable. The full
// structural truth is preserved in meta.counts / meta.hiddenChNodes.
export const CH_RENDER_CAP = 24

// Per-node CONTENT envelope (relative to the node center). A cluster boundary is
// the bounding box of its members' envelopes, so every node AND its labels sit
// inside the boundary.
//
// CONTRACT: these extents MUST track the label positions painted in
// topo-canvas.tsx (`NodeLabel`'s `r + 16` / `r + 31`, the LOCAL badge's
// `r + 25` / `r + 40`). If you move/resize a label in the canvas, update the
// matching extent here or the label spills outside its cluster rect. The numbers
// below decompose as: glyph radius (CH_R/KP_R) + label offset + line/badge height
// + a small descender allowance. See docs/knowledge/cluster-topology.md.
export const ENVELOPE_MARGIN = 12 // breathing room between content and the boundary

/** How far a ClickHouse glyph + its labels extend below its center. */
export function chDownExtent(n: ChNode): number {
  const showHost = n.host !== n.id || n.id.length > 12
  // sub-line at r+(16|31); LOCAL badge (local node) adds another ~17 below that.
  if (n.isLocal) return CH_R + (showHost ? 57 : 42)
  return CH_R + (showHost ? 36 : 21)
}
export const chUpExtent = () => CH_R + 8
// Sub-line can be wider than the card (e.g. "cpu 99% · mem 99%"); clear it.
export const chHalfExtent = () => CH_R + 34

/** Keeper hexagon + its labels. Leader has a star above; sub-line below.
 *
 * CONTRACT with `NodeLabel` in topo-canvas.tsx: when the host differs from the
 * short id (an FQDN), the canvas paints the host line at `r+16` AND the sub-line
 * at `r+31`; otherwise only the sub-line at `r+16`. The down-extent must cover
 * whichever is drawn (+ a descender) or the follower labels spill below the
 * keeper boundary into the cluster region — the reported overlap. */
export const keeperUpExtent = (k: KeeperNode) => KP_R + (k.isLeader ? 22 : 8)
export const keeperDownExtent = (k: KeeperNode) =>
  KP_R + (k.host !== k.id ? 42 : 26)
export const keeperHalfExtent = () => KP_R + 16

export const STATUS_COLOR: Record<string, string> = {
  healthy: '#10b981',
  warn: '#f59e0b',
  down: '#f43f5e',
  unreachable: '#94a3b8',
}

// Stable palette — EVERY cluster (logical and physical alike) draws a distinct
// color from this list in encounter order, so concentric/overlapping territories
// read as separate colored boundaries instead of a muddy stack of gray lines.
// Claude-style: warm, editorial, muted earth tones led by the Claude clay/coral,
// hues alternated warm↔cool so ADJACENT nested rings stay easy to tell apart.
export const CLUSTER_PALETTE = [
  '#CC785C', // Claude clay (coral) — brand signature
  '#7AA2C0', // dusty blue
  '#D9A05B', // honey amber
  '#9B8BC4', // periwinkle
  '#6BA292', // sage teal
  '#C77B8B', // dusty rose
  '#B5925A', // ochre
  '#8FA876', // olive
]

import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ClusterHull, TopologyModel } from './model'
import type { LiveMetrics } from './topo-glyphs'

import { CH_R, isKeeperNode, KP_R, STATUS_COLOR, VB_W } from './model'
import { ChGlyph, curvePath, HullLabel, KeeperGlyph } from './topo-glyphs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Conservative visual extents used for zoom-to-fit viewBox computation.
// These are upper bounds: they must be >= actual label extents so nothing clips.
// They intentionally match the contracts in model.ts (chDownExtent etc.) but as
// maximums rather than per-node values, which is fine for viewBox sizing.
const _CH_HALF = CH_R + 34 // chHalfExtent
const _CH_UP = CH_R + 8 // chUpExtent
const _CH_DOWN = CH_R + 57 // chDownExtent worst case (local + FQDN + badge)
const _KP_HALF = KP_R + 16 // keeperHalfExtent
const _KP_UP = KP_R + 22 // keeperUpExtent (leader star)
const _KP_DOWN = KP_R + 42 // keeperDownExtent worst case (FQDN host line)

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

type Pos = { x: number; y: number }
type PosMap = Record<string, Pos>

type DragKind = 'node' | 'group'

interface DragState {
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

const CLICK_SLOP = 4 // px in SVG space before a press counts as a drag

/**
 * Compute a tight content-aware viewBox string from the model.
 * Starts from the bounding box of all node visual extents (glyph + labels),
 * expands by HULL_EXTRA to cover cluster boundary rects and label pills, adds
 * FIT_PAD breathing room, enforces minimum dimensions (to cap zoom), and clamps
 * to the full model extent so the viewBox never excludes any content.
 */
function contentViewBox(model: TopologyModel, positions: PosMap): string {
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

function clientToSvg(
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
function cageForNode(
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

function clampToHull(x: number, y: number, hull: ClusterHull | null): Pos {
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
function groupSafeDelta(
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

interface TopoCanvasProps {
  model: TopologyModel
  /** Live metrics for the connected (is_local) node, keyed by node id. */
  liveById: Record<string, LiveMetrics>
  selected: string | null
  activeCluster: string | null
  onSelect: (id: string) => void
  onClearSelect: () => void
}

export function TopoCanvas({
  model,
  liveById,
  selected,
  activeCluster,
  onSelect,
  onClearSelect,
}: TopoCanvasProps) {
  const {
    keepers,
    chNodes,
    nodeById,
    clusterById,
    raftEdges,
    replEdges,
    coordEdges,
    clusterHulls,
    keeperHull,
    vbHeight,
  } = model

  const svgRef = useRef<SVGSVGElement | null>(null)
  // Manual position overrides (drag). Cleared when the structural model identity
  // changes enough that layout re-ran (keeper/ch node set changes).
  const [offsets, setOffsets] = useState<PosMap>({})
  const dragRef = useRef<DragState | null>(null)
  const liveDeltaRef = useRef<Pos>({ x: 0, y: 0 })
  const [dragTick, setDragTick] = useState(0) // force paint while dragging
  const structureKey = useMemo(
    () =>
      `${keepers.map((k) => k.id).join(',')}|${chNodes.map((n) => n.id).join(',')}|${clusterHulls.map((h) => h.id).join(',')}`,
    [keepers, chNodes, clusterHulls]
  )
  // Reset free-form positions when the topology structure changes.
  useEffect(() => {
    setOffsets({})
    dragRef.current = null
  }, [structureKey])

  const basePos = useCallback(
    (id: string): Pos => {
      const n = nodeById[id]
      if (!n) return { x: 0, y: 0 }
      const o = offsets[id]
      return o ? { x: n.x + o.x, y: n.y + o.y } : { x: n.x, y: n.y }
    },
    [nodeById, offsets]
  )

  const positions = useMemo(() => {
    const map: PosMap = {}
    for (const k of keepers) map[k.id] = basePos(k.id)
    for (const n of chNodes) map[n.id] = basePos(n.id)
    // Live drag preview — apply provisional delta without committing offsets yet.
    const d = dragRef.current
    if (d?.moved) {
      // positions already include committed offsets; drag uses start+delta via
      // a separate live map during paint — handled below via dragLive.
    }
    return map
  }, [keepers, chNodes, basePos])

  // Absolute positions for render (with live drag overlay via liveDeltaRef).
  const renderPos = useCallback(
    (id: string): Pos => {
      const d = dragRef.current
      if (d?.moved && d.nodeIds.includes(id)) {
        const s = d.start[id]
        if (s) {
          const raw = liveDeltaRef.current
          const delta =
            d.kind === 'group'
              ? groupSafeDelta(model, d, raw.x, raw.y, activeCluster)
              : raw
          const next = { x: s.x + delta.x, y: s.y + delta.y }
          // Keepers: soft-clamp to canvas. CH single-node: clamp to its box.
          if (isKeeperNode(nodeById[id]!)) {
            return {
              x: Math.min(VB_W - _KP_HALF, Math.max(_KP_HALF, next.x)),
              y: Math.min(model.vbHeight - _KP_DOWN, Math.max(_KP_UP, next.y)),
            }
          }
          if (d.kind === 'node') {
            const cage = cageForNode(model, id, activeCluster)
            return clampToHull(next.x, next.y, cage)
          }
          // Group: delta already group-safe; still clamp as a safety net.
          const cage =
            model.clusterHulls.find((h) => h.id === d.id) ??
            cageForNode(model, id, activeCluster)
          return clampToHull(next.x, next.y, cage)
        }
      }
      return positions[id] ?? basePos(id)
    },
    [positions, basePos, model, activeCluster, nodeById]
  )

  // dragTick intentionally invalidates while a drag is in progress so live
  // positions (read from liveDeltaRef) re-materialize each pointermove.
  const posById = useMemo(() => {
    const map: PosMap = {}
    for (const k of keepers) map[k.id] = renderPos(k.id)
    for (const n of chNodes) map[n.id] = renderPos(n.id)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragTick drives live drag frames
  }, [keepers, chNodes, renderPos, dragTick, offsets])

  const edge = (a: string, b: string) => {
    const pa = posById[a]
    const pb = posById[b]
    if (!pa || !pb) return null
    return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y }
  }
  const memberOf = (id: string) =>
    activeCluster ? !!clusterById[activeCluster]?.members[id] : true

  const vb = contentViewBox(model, posById)

  const beginDrag = useCallback(
    (e: ReactPointerEvent, kind: DragKind, id: string, nodeIds: string[]) => {
      const svg = svgRef.current
      if (!svg || nodeIds.length === 0) return
      const origin = clientToSvg(svg, e.clientX, e.clientY)
      const start: PosMap = {}
      for (const nid of nodeIds) start[nid] = basePos(nid)
      dragRef.current = {
        kind,
        id,
        nodeIds,
        origin,
        start,
        moved: false,
        pointerId: e.pointerId,
      }
      liveDeltaRef.current = { x: 0, y: 0 }
      try {
        svg.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [basePos]
  )

  const onNodePointerDown = useCallback(
    (e: ReactPointerEvent, id: string) => {
      // Alt / Option + drag moves the whole cluster the node belongs to
      // (prefer active filter, else smallest containing hull).
      if (e.altKey) {
        const cage = cageForNode(model, id, activeCluster)
        if (cage) {
          const members = Object.keys(clusterById[cage.id]?.members ?? {})
          beginDrag(e, 'group', cage.id, members)
          return
        }
      }
      beginDrag(e, 'node', id, [id])
    },
    [beginDrag, model, activeCluster, clusterById]
  )

  const onGroupPointerDown = useCallback(
    (e: ReactPointerEvent, clusterId: string) => {
      const members = Object.keys(clusterById[clusterId]?.members ?? {})
      // Only CH members — keepers are not inside CH boxes.
      const chMembers = members.filter((id) => {
        const n = nodeById[id]
        return n && !isKeeperNode(n)
      })
      beginDrag(e, 'group', clusterId, chMembers)
    },
    [beginDrag, clusterById, nodeById]
  )

  const onSvgPointerMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current
    const svg = svgRef.current
    if (!d || !svg || e.pointerId !== d.pointerId) return
    const cur = clientToSvg(svg, e.clientX, e.clientY)
    const dx = cur.x - d.origin.x
    const dy = cur.y - d.origin.y
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    d.moved = true
    liveDeltaRef.current = { x: dx, y: dy }
    setDragTick((t) => t + 1)
  }, [])

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current
      const svg = svgRef.current
      if (!d || e.pointerId !== d.pointerId) return
      try {
        svg?.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (!d.moved) {
        // Pure click — select node (or select nothing for group press).
        if (d.kind === 'node') onSelect(d.id)
        dragRef.current = null
        liveDeltaRef.current = { x: 0, y: 0 }
        return
      }
      // Commit offsets so nodes stay where the user dropped them (still clamped).
      const raw = liveDeltaRef.current
      const delta =
        d.kind === 'group'
          ? groupSafeDelta(model, d, raw.x, raw.y, activeCluster)
          : raw
      setOffsets((prev) => {
        const next = { ...prev }
        const groupHull =
          d.kind === 'group'
            ? (model.clusterHulls.find((h) => h.id === d.id) ?? null)
            : null
        for (const nid of d.nodeIds) {
          const base = nodeById[nid]
          if (!base) continue
          const start = d.start[nid]
          if (!start) continue
          let x = start.x + delta.x
          let y = start.y + delta.y
          if (!isKeeperNode(base)) {
            const cage = groupHull ?? cageForNode(model, nid, activeCluster)
            const c = clampToHull(x, y, cage)
            x = c.x
            y = c.y
          } else {
            x = Math.min(VB_W - _KP_HALF, Math.max(_KP_HALF, x))
            y = Math.min(model.vbHeight - _KP_DOWN, Math.max(_KP_UP, y))
          }
          // Store as offset from layout position.
          next[nid] = { x: x - base.x, y: y - base.y }
        }
        return next
      })
      dragRef.current = null
      liveDeltaRef.current = { x: 0, y: 0 }
      setDragTick((t) => t + 1)
    },
    [nodeById, model, activeCluster, onSelect]
  )

  // Keepers rendered with live positions.
  const keepersLive = keepers.map((k) => {
    const p = posById[k.id]
    return p ? { ...k, x: p.x, y: p.y } : k
  })
  const chLive = chNodes.map((n) => {
    const p = posById[n.id]
    return p ? { ...n, x: p.x, y: p.y } : n
  })

  const dragging = !!dragRef.current?.moved

  return (
    <svg
      ref={svgRef}
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      className={
        dragging
          ? 'topo-canvas block h-full w-full select-none dragging'
          : 'topo-canvas block h-full w-full select-none'
      }
      onClick={() => {
        if (!dragRef.current?.moved) onClearSelect()
      }}
      onPointerMove={onSvgPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="img"
      aria-label="Cluster topology graph. Drag a node to move it; drag a cluster fill or Alt-drag a node to move the group. Nodes stay inside their cluster box."
    >
      <defs>
        <pattern
          id="topo-dots"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx="1.2"
            cy="1.2"
            r="1.2"
            fill="var(--muted-foreground)"
            opacity="0.09"
          />
        </pattern>
        {/* Soft glass blur for hull fills (G8). Lightweight — no heavy drop-shadows. */}
        <filter id="topo-glass-blur" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" />
        </filter>
      </defs>
      <rect x="0" y="0" width={VB_W} height={vbHeight} fill="url(#topo-dots)" />

      {/* keeper quorum region — soft glass container */}
      {keeperHull && (
        <g
          opacity={activeCluster ? 0.4 : 1}
          style={{ transition: 'opacity .25s' }}
        >
          <path
            d={keeperHull}
            fill={STATUS_COLOR.healthy}
            fillOpacity="0.07"
            stroke={STATUS_COLOR.healthy}
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="6 5"
          />
          {keepers[0] && (
            <HullLabel
              x={VB_W / 2}
              y={Math.max(
                13,
                Math.min(...keepersLive.map((k) => k.y)) - KP_R - 32
              )}
              text="Keeper quorum · Raft"
              color={STATUS_COLOR.healthy}
            />
          )}
        </g>
      )}

      {/* Cluster territories — G8 glass fills.
          NO overlapping borders: within a coincident nest group only nestRank 0
          (outermost) draws a stroke; inner rings are fill-only. No casing stroke
          under the color (that stacked three borders at intersections). */}
      {clusterHulls.map((h) => {
        const active = activeCluster === h.id
        const faded = activeCluster && !active
        const isOuter = h.nestRank === 0
        // Glass fills: a bit richer than the old flat overlay.
        const fillOp = h.outline ? (active ? 0.08 : 0.045) : active ? 0.16 : 0.1
        const strokeOp = h.outline ? (active ? 0.7 : 0.4) : active ? 0.85 : 0.55
        // Only the outermost ring of a coincident nest draws a border.
        // Distinct (non-nested) clusters always get a single stroke.
        const drawStroke =
          isOuter ||
          !clusterHulls.some(
            (o) => o.memberSig === h.memberSig && o.id !== h.id
          )
        const strokeW = h.outline ? (active ? 1.8 : 1.4) : active ? 2.2 : 1.7

        return (
          <g
            key={h.id}
            opacity={faded ? (h.outline ? 0.22 : 0.2) : 1}
            style={{ transition: 'opacity .25s' }}
          >
            {/* Hit target + glass fill — pointerdown moves the whole group. */}
            <path
              d={h.d}
              fill={h.color}
              fillOpacity={fillOp}
              className="topo-hull-hit"
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onGroupPointerDown(e, h.id)
              }}
              onClick={(e) => {
                // Select cluster filter on click-without-drag is handled by parent
                // via activeCluster chips; hull click just focuses selection clear.
                e.stopPropagation()
              }}
            />
            {drawStroke && (
              <path
                d={h.d}
                fill="none"
                stroke={h.color}
                strokeOpacity={strokeOp}
                strokeWidth={strokeW}
                strokeLinejoin="round"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {h.leader && (
              <line
                x1={h.labelX}
                y1={h.labelY - 9}
                x2={h.anchorX}
                y2={h.anchorY}
                stroke={h.color}
                strokeOpacity={active ? 0.7 : 0.4}
                strokeWidth="1"
                strokeDasharray="2 3"
                style={{ pointerEvents: 'none' }}
              />
            )}
            <HullLabel
              x={h.labelX}
              y={h.labelY}
              text={h.name}
              color={h.color}
            />
          </g>
        )
      })}

      {/* edges — follow live node positions */}
      <g
        opacity={activeCluster ? 0.35 : 1}
        style={{ transition: 'opacity .25s', pointerEvents: 'none' }}
      >
        {coordEdges.map(([a, b], i) => {
          const e = edge(a, b)
          if (!e) return null
          return (
            <path
              key={`c${i}`}
              d={curvePath(e.x1, e.y1, e.x2, e.y2)}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
          )
        })}
        {raftEdges.map(([a, b], i) => {
          const e = edge(a, b)
          if (!e) return null
          return (
            <path
              key={`r${i}`}
              d={curvePath(e.x1, e.y1, e.x2, e.y2)}
              fill="none"
              stroke={STATUS_COLOR.healthy}
              strokeOpacity="0.4"
              strokeWidth="1.8"
            />
          )
        })}
      </g>
      {replEdges.map(([a, b], i) => {
        const e = edge(a, b)
        if (!e) return null
        const lit = !activeCluster || (memberOf(a) && memberOf(b))
        return (
          <path
            key={`p${i}`}
            d={curvePath(e.x1, e.y1, e.x2, e.y2)}
            fill="none"
            stroke="#3b82f6"
            strokeOpacity={lit ? 0.5 : 0.12}
            strokeWidth="2"
            style={{ transition: 'stroke-opacity .25s', pointerEvents: 'none' }}
          />
        )
      })}

      {/* nodes */}
      {keepersLive.map((n) => (
        <KeeperGlyph
          key={n.id}
          node={n}
          selected={selected === n.id}
          dimmed={false}
          onSelect={onSelect}
          onPointerDown={onNodePointerDown}
        />
      ))}
      {chLive.map((n) => (
        <ChGlyph
          key={n.id}
          node={n}
          live={liveById[n.id]}
          selected={selected === n.id}
          dimmed={activeCluster ? !memberOf(n.id) : false}
          onSelect={onSelect}
          onPointerDown={onNodePointerDown}
        />
      ))}
    </svg>
  )
}

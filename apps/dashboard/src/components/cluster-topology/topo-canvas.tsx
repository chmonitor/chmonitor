import type { PointerEvent as ReactPointerEvent } from 'react'
import type { TopologyModel } from './model'
import type { DragKind, DragState, Pos, PosMap } from './topo-canvas-geometry'
import type { LiveMetrics } from './topo-glyphs'

import { isKeeperNode, KP_R, STATUS_COLOR, VB_W } from './model'
import {
  _KP_DOWN,
  _KP_HALF,
  _KP_UP,
  CLICK_SLOP,
  cageForNode,
  clampToHull,
  clientToSvg,
  contentViewBox,
  groupSafeDelta,
} from './topo-canvas-geometry'
import { ChGlyph, curvePath, HullLabel, KeeperGlyph } from './topo-glyphs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: structureKey is derived from keepers/chNodes/clusterHulls and is the intended trigger for this reset
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: dragTick drives live drag frames and offsets must retrigger the live position recompute; both are deliberate
  const posById = useMemo(() => {
    const map: PosMap = {}
    for (const k of keepers) map[k.id] = renderPos(k.id)
    for (const n of chNodes) map[n.id] = renderPos(n.id)
    return map
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

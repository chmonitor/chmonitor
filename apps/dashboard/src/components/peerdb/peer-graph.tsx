'use client'

import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  Panel,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { MirrorListItem, PeerListItem } from '@/lib/peerdb/types'

import { getPeerTypeIcon } from './peer-type-icon'
import { dbTypeLabel, statusTone, TONE_COLOR } from './peerdb-utils'
import { useEffect, useMemo, useRef } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { computeDagrePositions } from '@/lib/graph/dagre-layout'
import { cn } from '@/lib/utils'

const NODE_WIDTH = 220
const NODE_HEIGHT = 64

/** Stable fit-view options shared across renders (module-level constant). */
const FIT_VIEW_OPTIONS = { padding: 0.2, minZoom: 0.4, maxZoom: 1.5 }

interface PeerNodeData {
  label: string
  type?: string | number
  [key: string]: unknown
}

/** Custom React Flow node: a peer with its type icon, name, and type label. */
function PeerNode({
  data,
  targetPosition = Position.Left,
  sourcePosition = Position.Right,
}: {
  data: PeerNodeData
  targetPosition?: Position
  sourcePosition?: Position
}) {
  const { Icon, color } = getPeerTypeIcon(data.type)
  return (
    <div className="w-[200px] rounded-lg border-2 border-border bg-card px-3 py-2.5 transition-all hover:border-primary/50">
      <Handle type="target" position={targetPosition} className="!invisible" />
      <Link
        href={`/peerdb/peer?name=${encodeURIComponent(data.label)}`}
        className="flex items-center gap-2"
        title={`${data.label} (${dbTypeLabel(data.type)})`}
      >
        <Icon className={cn('size-5 shrink-0', color)} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-tight">
            {data.label}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {dbTypeLabel(data.type)}
          </span>
        </div>
      </Link>
      <Handle type="source" position={sourcePosition} className="!invisible" />
    </div>
  )
}

const nodeTypes = { peerNode: PeerNode }

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const positions = computeDagrePositions(
    nodes.map((n) => n.id),
    edges,
    {
      direction: 'LR',
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      nodesep: 50,
      ranksep: 120,
    }
  )

  return nodes.map((node, index) => {
    // Isolated peers (no mirror) get stacked in a column on the left.
    const position = positions.get(node.id) ?? {
      x: 0,
      y: index * (NODE_HEIGHT + 24),
    }
    return {
      ...node,
      position,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
    }
  })
}

/** Cap on rendered source→dest edges so large fleets stay legible. */
const MAX_PAIRS = 60
/** Worst-first ordering: when capping, keep attention-worthy pairs. */
const TONE_PRIORITY = ['failed', 'paused', 'progress', 'running', 'idle']

function worseTone(a: string, b: string): string {
  return TONE_PRIORITY.indexOf(a) <= TONE_PRIORITY.indexOf(b) ? a : b
}

interface BuiltGraph {
  nodes: Node[]
  edges: Edge[]
  totalPairs: number
  shownPairs: number
  totalPeers: number
}

/**
 * Build the topology graph. Parallel mirrors between the same source→dest peers
 * are collapsed into a single edge (labeled with a count) so 352 mirrors don't
 * render as 352 overlapping lines. Edges are capped at MAX_PAIRS, and only peers
 * referenced by a shown edge become nodes — keeping the view legible at scale.
 */
function buildGraph(
  peers: PeerListItem[],
  mirrors: MirrorListItem[]
): BuiltGraph {
  const peerType = new Map<string, string | number | undefined>()
  for (const p of peers) peerType.set(p.name, p.type)

  const pairs = new Map<
    string,
    { source: string; target: string; count: number; tone: string }
  >()
  for (const m of mirrors) {
    if (!m.sourceName || !m.destinationName) continue
    if (!peerType.has(m.sourceName)) peerType.set(m.sourceName, m.sourceType)
    if (!peerType.has(m.destinationName))
      peerType.set(m.destinationName, m.destinationType)
    const key = `${m.sourceName} ${m.destinationName}`
    const tone = statusTone(m.status)
    const ex = pairs.get(key)
    if (ex) {
      ex.count++
      ex.tone = worseTone(ex.tone, tone)
    } else {
      pairs.set(key, {
        source: m.sourceName,
        target: m.destinationName,
        count: 1,
        tone,
      })
    }
  }

  const totalPairs = pairs.size
  const pairList = Array.from(pairs.values()).sort(
    (a, b) => TONE_PRIORITY.indexOf(a.tone) - TONE_PRIORITY.indexOf(b.tone)
  )
  const shown = pairList.slice(0, MAX_PAIRS)
  const showLabels = shown.length <= 24

  const used = new Set<string>()
  const edges: Edge[] = shown.map((p) => {
    used.add(p.source)
    used.add(p.target)
    const color =
      TONE_COLOR[p.tone as keyof typeof TONE_COLOR] ?? TONE_COLOR.idle
    return {
      id: `${p.source}->${p.target}`,
      source: p.source,
      target: p.target,
      animated: showLabels && p.tone === 'running',
      ...(showLabels && p.count > 1
        ? {
            label: `${p.count} mirrors`,
            labelStyle: { fill: 'var(--foreground)', fontSize: 10 },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 4,
            labelBgStyle: {
              fill: color,
              fillOpacity: 0.15,
              stroke: color,
              strokeWidth: 1,
            },
          }
        : {}),
      ...(showLabels
        ? {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color,
              width: 16,
              height: 16,
            },
          }
        : {}),
      style: {
        stroke: color,
        strokeWidth: showLabels ? 2 : 1.2,
        strokeOpacity: showLabels ? 1 : 0.5,
      },
    }
  })

  // Render a node for every configured peer (not just those on a shown edge) so
  // a fresh PeerDB install with peers but no mirrors still shows its topology.
  const nodeNames = new Set<string>(used)
  for (const p of peers) nodeNames.add(p.name)

  const nodes: Node[] = Array.from(nodeNames).map((name) => ({
    id: name,
    type: 'peerNode',
    position: { x: 0, y: 0 },
    data: { label: name, type: peerType.get(name) },
  }))

  return {
    nodes,
    edges,
    totalPairs,
    shownPairs: shown.length,
    totalPeers: peerType.size,
  }
}

interface PeerGraphProps {
  peers: PeerListItem[]
  mirrors: MirrorListItem[]
  className?: string
}

/** Source→destination relationship graph: peers are nodes, mirrors are edges. */
export function PeerGraph({ peers, mirrors, className }: PeerGraphProps) {
  const instance = useRef<ReactFlowInstance | null>(null)

  // Stable signature of the input data. Both callers (peers.tsx and
  // peerdb/index.tsx) build a NEW peers/mirrors array on every render, so keying
  // the layout memo on those arrays directly would recompute each render and
  // re-fire the sync effect below forever (React error #185). Stringifying
  // collapses content-equal inputs to an Object.is-equal string, keeping the
  // memo — and the node/edge references it returns — stable until the data
  // actually changes. Mirrors the depsKey pattern in dependency-graph.tsx.
  const graphKey = useMemo(
    () => JSON.stringify({ peers, mirrors }),
    [peers, mirrors]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: graphKey is a stable signature of peers+mirrors
  const graph = useMemo(() => {
    const built = buildGraph(peers, mirrors)
    return {
      layoutedNodes: layout(built.nodes, built.edges),
      rawEdges: built.edges,
      totalPairs: built.totalPairs,
      shownPairs: built.shownPairs,
      totalPeers: built.totalPeers,
    }
  }, [graphKey])
  const { layoutedNodes, rawEdges, totalPairs, shownPairs, totalPeers } = graph

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges)

  // layoutedNodes/rawEdges are stable references (memoized on graphKey), so this
  // sync fires only when the graph data actually changes — never every render.
  useEffect(() => {
    setNodes(layoutedNodes)
    setEdges(rawEdges)
  }, [layoutedNodes, rawEdges, setNodes, setEdges])

  const onInit = (inst: ReactFlowInstance) => {
    instance.current = inst
    setTimeout(() => inst.fitView(FIT_VIEW_OPTIONS), 100)
  }

  if (nodes.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-muted/10 text-muted-foreground',
          className
        )}
      >
        No peers found
      </div>
    )
  }

  return (
    <div className={cn('w-full rounded-lg border', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <Panel position="top-right" className="text-xs text-muted-foreground">
          {totalPeers} peers · {totalPairs} routes
          {shownPairs < totalPairs ? ` · showing top ${shownPairs}` : ''}
        </Panel>
      </ReactFlow>
    </div>
  )
}

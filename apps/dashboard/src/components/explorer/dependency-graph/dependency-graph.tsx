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

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { getEngineIconConfig } from '@/lib/clickhouse-engine-icons'
import { computeDagrePositions } from '@/lib/graph/dagre-layout'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

/**
 * Dependency type indicating the nature of the relationship
 */
export type DependencyType =
  | 'dependency' // Standard MV/View dependency from system.tables
  | 'dictGet' // dictGet() function call in definition
  | 'joinGet' // joinGet() function call in definition
  | 'mv_target' // MV writes TO this table
  | 'dict_source' // Dictionary source table
  | 'external' // External engine (PostgreSQL, Kafka, etc.)

/**
 * Dependency data from the API
 */
export interface DependencyEdge {
  source_database: string
  source_table: string
  source_engine: string
  target_database?: string
  target_table?: string
  dependency_type?: DependencyType
  extra_info?: string
}

interface DependencyGraphProps {
  dependencies: DependencyEdge[]
  currentTable?: string
  currentDatabase?: string
  className?: string
}

// Layout direction type
type LayoutDirection = 'TB' | 'LR'

// Node dimensions for dagre layout (must match actual rendered size)
const NODE_WIDTH = 280
const NODE_HEIGHT = 65

// Stable fit-view options shared across renders (module-level constant)
const FIT_VIEW_OPTIONS = {
  padding: 0.2,
  minZoom: 0.5,
  maxZoom: 1.5,
}

/**
 * Custom node component for tables/views
 * Supports dynamic handle positions for vertical (TB) and horizontal (LR) layouts
 * Handles are invisible but still functional for edge connections
 */
function TableNode({
  data,
  targetPosition = Position.Top,
  sourcePosition = Position.Bottom,
}: {
  data: {
    label: string
    engine: string
    database: string
    isCurrent: boolean
    hostId: number
  }
  targetPosition?: Position
  sourcePosition?: Position
}) {
  const engineConfig = getEngineIconConfig(data.engine)
  const Icon = engineConfig.icon

  return (
    <div
      className={cn(
        'w-[260px] rounded-lg border-2 bg-card px-4 py-3 transition-all',
        data.isCurrent
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:border-primary/50'
      )}
    >
      {/* Invisible handles for edge connections */}
      <Handle type="target" position={targetPosition} className="!invisible" />
      <Link
        href={`/explorer?host=${data.hostId}&database=${encodeURIComponent(data.database)}&table=${encodeURIComponent(data.label)}&engine=${encodeURIComponent(data.engine)}`}
        className="flex items-center gap-2"
        title={`${data.label} (${data.engine})`}
      >
        <Icon
          className={cn('size-5 shrink-0', engineConfig.color)}
          aria-label={data.engine}
        />
        <div className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate text-sm font-semibold leading-tight',
              data.isCurrent && 'text-primary'
            )}
          >
            {data.label}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {data.engine}
          </span>
        </div>
      </Link>
      <Handle type="source" position={sourcePosition} className="!invisible" />
    </div>
  )
}

const nodeTypes = {
  tableNode: TableNode,
}

/**
 * Legend item component for dependency type (shadcn badge style)
 */
function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string
  label: string
  dashed?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="24" height="12" className="shrink-0">
        <line
          x1="0"
          y1="6"
          x2="24"
          y2="6"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? '4,3' : undefined}
        />
        <polygon points="20,3 24,6 20,9" fill={color} />
      </svg>
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          backgroundColor: `${color}15`,
          color: color,
          border: `1px solid ${color}30`,
        }}
      >
        {label}
      </span>
    </div>
  )
}

/**
 * Get edge color based on dependency type
 */
function getDependencyColor(type?: DependencyType): string {
  switch (type) {
    case 'dictGet':
      return '#f97316' // orange-500
    case 'joinGet':
      return '#8b5cf6' // violet-500
    case 'mv_target':
      return '#22c55e' // green-500
    case 'dict_source':
      return '#f59e0b' // amber-500
    case 'external':
      return '#94a3b8' // slate-400
    default:
      return '#3b82f6' // blue-500 for MV/View
  }
}

/**
 * Get edge label based on dependency type
 */
function getDependencyLabel(type?: DependencyType): string | undefined {
  switch (type) {
    case 'dictGet':
      return 'dictGet'
    case 'joinGet':
      return 'joinGet'
    case 'mv_target':
      return 'TO'
    case 'dict_source':
      return 'source'
    default:
      return undefined
  }
}

/**
 * Apply dagre layout to connected nodes, and grid layout to isolated nodes
 * Dagre uses center-center anchor, React Flow uses top-left
 */
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const isHorizontal = direction === 'LR'

  // Find connected node IDs (nodes that have edges)
  const connectedNodeIds = new Set<string>()
  edges.forEach((edge) => {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  })

  // Separate connected and isolated nodes
  const connectedNodes = nodes.filter((n) => connectedNodeIds.has(n.id))
  const isolatedNodes = nodes.filter((n) => !connectedNodeIds.has(n.id))

  const layoutedNodes: Node[] = []

  // Layout connected nodes with dagre (shared core in lib/graph/dagre-layout)
  if (connectedNodes.length > 0) {
    const positions = computeDagrePositions(
      connectedNodes.map((node) => node.id),
      edges,
      {
        direction,
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        nodesep: 60,
        ranksep: 80,
      }
    )

    connectedNodes.forEach((node) => {
      const position = positions.get(node.id)
      if (!position) return
      layoutedNodes.push({
        ...node,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
        position,
      })
    })
  }

  // Layout isolated nodes in a grid below/beside the connected graph
  if (isolatedNodes.length > 0) {
    // Calculate bounding box of connected nodes
    let maxY = 0
    let maxX = 0
    layoutedNodes.forEach((node) => {
      maxY = Math.max(maxY, node.position.y + NODE_HEIGHT)
      maxX = Math.max(maxX, node.position.x + NODE_WIDTH)
    })

    // Grid layout for isolated nodes - generous spacing to prevent overlap
    const GRID_GAP = 30
    const COLS = isHorizontal ? 3 : 4 // Fewer columns for horizontal layout
    const startY = connectedNodes.length > 0 ? maxY + 60 : 0
    const startX = 0

    isolatedNodes.forEach((node, index) => {
      const col = index % COLS
      const row = Math.floor(index / COLS)
      layoutedNodes.push({
        ...node,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
        position: {
          x: startX + col * (NODE_WIDTH + GRID_GAP),
          y: startY + row * (NODE_HEIGHT + GRID_GAP),
        },
      })
    })
  }

  return { nodes: layoutedNodes, edges }
}

/**
 * Build initial nodes and edges from dependency data
 */
function buildInitialGraph(
  dependencies: DependencyEdge[],
  currentTable: string | undefined,
  currentDatabase: string | undefined,
  hostId: number
): { nodes: Node[]; edges: Edge[]; edgeCount: number } {
  const nodeMap = new Map<
    string,
    { database: string; table: string; engine: string }
  >()
  const edges: Edge[] = []

  // Collect all unique tables and build edges
  for (const dep of dependencies) {
    const sourceKey = `${dep.source_database}.${dep.source_table}`
    if (!nodeMap.has(sourceKey)) {
      nodeMap.set(sourceKey, {
        database: dep.source_database,
        table: dep.source_table,
        engine: dep.source_engine,
      })
    }

    if (dep.target_table && dep.target_database) {
      const targetKey = `${dep.target_database}.${dep.target_table}`
      if (!nodeMap.has(targetKey)) {
        nodeMap.set(targetKey, {
          database: dep.target_database,
          table: dep.target_table,
          engine: 'Table',
        })
      }

      // Create styled edge
      const edgeColor = getDependencyColor(dep.dependency_type)
      const edgeLabel = getDependencyLabel(dep.dependency_type)
      edges.push({
        id: `${sourceKey}->${targetKey}-${dep.dependency_type || 'dep'}`,
        source: sourceKey,
        target: targetKey,
        animated: dep.dependency_type === 'mv_target',
        label: edgeLabel,
        labelStyle: edgeLabel
          ? {
              fill: 'var(--foreground)',
              fontSize: 10,
              fontWeight: 500,
            }
          : undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: edgeLabel
          ? {
              fill: edgeColor,
              fillOpacity: 0.15,
              stroke: edgeColor,
              strokeWidth: 1,
            }
          : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 20,
          height: 20,
        },
        style: {
          stroke: edgeColor,
          strokeWidth: 2,
          strokeDasharray:
            dep.dependency_type === 'external' ? '5,5' : undefined,
        },
      })
    }
  }

  // Create nodes with initial positions (will be recalculated by dagre)
  const nodes: Node[] = Array.from(nodeMap.entries()).map(([key, info]) => ({
    id: key,
    type: 'tableNode',
    position: { x: 0, y: 0 }, // Will be set by dagre
    data: {
      label: info.table,
      engine: info.engine,
      database: info.database,
      isCurrent:
        info.table === currentTable && info.database === currentDatabase,
      hostId,
    },
  }))

  return { nodes, edges, edgeCount: edges.length }
}

/**
 * Dependency graph visualization using React Flow with dagre auto-layout
 */
export function DependencyGraph({
  dependencies,
  currentTable,
  currentDatabase,
  className,
}: DependencyGraphProps) {
  const hostId = useHostId()
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null)
  const [direction, setDirection] = useState<LayoutDirection>('TB')
  const [isMounted, setIsMounted] = useState(false)

  // Avoid hydration mismatch by rendering a placeholder until mounted on client
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Stable string representation of dependencies to prevent unnecessary recalculations
  const depsKey = useMemo(() => JSON.stringify(dependencies), [dependencies])

  // Build and layout the graph structure stably
  // biome-ignore lint/correctness/useExhaustiveDependencies: depsKey is a stable representation of dependencies to prevent unnecessary recalculations
  const { layoutedNodes, layoutedEdges, edgeCount } = useMemo(() => {
    const {
      nodes: rawNodes,
      edges: rawEdges,
      edgeCount,
    } = buildInitialGraph(dependencies, currentTable, currentDatabase, hostId)
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      rawNodes,
      rawEdges,
      direction
    )
    return { layoutedNodes, layoutedEdges, edgeCount }
  }, [depsKey, currentTable, currentDatabase, hostId, direction])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges)

  // Update nodes and edges when layoutedNodes or layoutedEdges change
  useEffect(() => {
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges])

  // Fit view when nodes change
  useEffect(() => {
    if (reactFlowInstance.current && nodes.length > 0) {
      const timer = setTimeout(() => {
        reactFlowInstance.current?.fitView(FIT_VIEW_OPTIONS)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [nodes])

  const onInit = (instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance
    setTimeout(() => {
      instance.fitView(FIT_VIEW_OPTIONS)
    }, 100)
  }

  // Toggle layout direction
  const onLayoutChange = (newDirection: LayoutDirection) => {
    setDirection(newDirection)
  }

  if (!isMounted) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-muted/10 text-muted-foreground',
          className
        )}
      >
        <span className="text-xs">Loading graph...</span>
      </div>
    )
  }

  if (dependencies.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-muted/10 text-muted-foreground',
          className
        )}
      >
        No tables found
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
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />

        {/* Layout controls */}
        <Panel position="top-left" className="flex gap-1">
          <button
            type="button"
            onClick={() => onLayoutChange('TB')}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              direction === 'TB'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            )}
          >
            Vertical
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange('LR')}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              direction === 'LR'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            )}
          >
            Horizontal
          </button>
        </Panel>

        {/* Stats panel */}
        <Panel position="top-right" className="text-xs text-muted-foreground">
          {nodes.length} tables{edgeCount > 0 && `, ${edgeCount} dependencies`}
        </Panel>

        {/* Legend panel - only show when there are edges */}
        {edgeCount > 0 && (
          <Panel
            position="bottom-left"
            className="rounded-lg border bg-card/95 p-2.5 backdrop-blur-sm"
          >
            <div className="mb-2 text-xs font-medium text-foreground">
              Dependency Types
            </div>
            <div className="flex flex-col gap-1.5">
              <LegendItem color="#3b82f6" label="MV/View" />
              <LegendItem color="#f97316" label="dictGet" />
              <LegendItem color="#8b5cf6" label="joinGet" />
              <LegendItem color="#22c55e" label="TO" />
              <LegendItem color="#f59e0b" label="source" />
              <LegendItem color="#94a3b8" label="external" dashed />
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}

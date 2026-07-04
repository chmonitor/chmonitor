/**
 * Grid — lays out `DashboardWidget[]` on the fixed 12-column dashboard grid
 * (see `@/types/dashboard-layout` for the coordinate-system contract).
 *
 * View mode renders widgets read-only at their saved positions with plain
 * CSS Grid — no dnd-kit involved at all, so viewing a dashboard never pays
 * for the drag/resize machinery.
 *
 * Arrange mode adds:
 *   - Move: `@dnd-kit/core`'s `useDraggable`/`DndContext`, translate-delta
 *     based — a widget's pixel drag delta is rounded to a whole number of
 *     grid cells, then applied to its `x`/`y` on drop.
 *   - Resize: plain pointer events (pointerdown/move/up with pointer
 *     capture) on a corner handle — dnd-kit has no resize primitive, and
 *     this keeps the diff free of a second drag library.
 *   - Both operations reject (snap back to the last valid position/size) a
 *     move/resize that would overlap another widget — the collision rule
 *     documented in `dashboard-layout.ts`. This is deliberately simple: no
 *     packing/push-down algorithm, just accept-or-reject.
 */

import type { DragEndEvent } from '@dnd-kit/core'
import type {
  CSSProperties,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { DashboardWidget } from '@/types/dashboard-layout'

import { WidgetChart } from './widget-chart'
import { WidgetFrame } from './widget-frame'
import { WidgetStat } from './widget-stat'
import { WidgetTable } from './widget-table'
import { WidgetText } from './widget-text'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useEffect, useRef, useState } from 'react'
import {
  GRID_COLUMNS,
  GRID_GAP_PX,
  GRID_ROW_HEIGHT_PX,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  widgetsCollide,
} from '@/types/dashboard-layout'

export interface GridProps {
  widgets: DashboardWidget[]
  mode: 'view' | 'arrange'
  onChange: (widgets: DashboardWidget[]) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** kebab-case registry/query-config name -> "Title Case" display label. */
function kebabToTitleCase(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function widgetTitle(widget: DashboardWidget): string {
  if (widget.title) return widget.title
  if (widget.type === 'chart' && widget.chartName)
    return kebabToTitleCase(widget.chartName)
  if (widget.type === 'table' && widget.queryConfigName)
    return kebabToTitleCase(widget.queryConfigName)
  return widget.type === 'stat'
    ? 'Stat'
    : widget.type === 'text'
      ? 'Text'
      : 'Widget'
}

function gridPositionStyle(widget: DashboardWidget): CSSProperties {
  return {
    gridColumn: `${widget.x + 1} / span ${widget.w}`,
    gridRow: `${widget.y + 1} / span ${widget.h}`,
  }
}

function WidgetContent({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case 'chart':
      return <WidgetChart widget={widget} />
    case 'table':
      return <WidgetTable widget={widget} />
    case 'stat':
      return <WidgetStat widget={widget} />
    case 'text':
      return <WidgetText widget={widget} />
    default:
      return null
  }
}

const GRID_CONTAINER_CLASS = 'grid gap-3'

function gridContainerStyle(): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
    gridAutoRows: `${GRID_ROW_HEIGHT_PX}px`,
  }
}

/** Read-only grid — no dnd-kit, widgets positioned via plain CSS Grid. */
function ViewGrid({ widgets }: { widgets: DashboardWidget[] }) {
  return (
    <div className={GRID_CONTAINER_CLASS} style={gridContainerStyle()}>
      {widgets.map((widget) => (
        <div
          key={widget.id}
          style={gridPositionStyle(widget)}
          className="min-w-0"
        >
          <WidgetFrame title={widgetTitle(widget)} mode="view">
            <WidgetContent widget={widget} />
          </WidgetFrame>
        </div>
      ))}
    </div>
  )
}

interface ArrangeGridItemProps {
  widget: DashboardWidget
  colWidth: number
  onRemove: () => void
  onResize: (w: number, h: number) => void
  children: ReactNode
}

function ArrangeGridItem({
  widget,
  colWidth,
  onRemove,
  onResize,
  children,
}: ArrangeGridItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: widget.id })

  const [resizeDelta, setResizeDelta] = useState<{
    dw: number
    dh: number
  } | null>(null)
  const resizeStart = useRef<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const cellW = colWidth + GRID_GAP_PX
  const cellH = GRID_ROW_HEIGHT_PX + GRID_GAP_PX

  function handleResizePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: widget.w,
      h: widget.h,
    }
    setResizeDelta({ dw: 0, dh: 0 })
  }

  function handleResizePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!resizeStart.current || !colWidth) return
    const dw = Math.round((e.clientX - resizeStart.current.x) / cellW)
    const dh = Math.round((e.clientY - resizeStart.current.y) / cellH)
    setResizeDelta({ dw, dh })
  }

  function handleResizePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!resizeStart.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const start = resizeStart.current
    const delta = resizeDelta
    resizeStart.current = null
    setResizeDelta(null)
    if (!delta || (delta.dw === 0 && delta.dh === 0)) return
    onResize(start.w + delta.dw, start.h + delta.dh)
  }

  const previewStyle: CSSProperties | undefined = resizeDelta
    ? {
        width: `calc(100% + ${resizeDelta.dw * cellW}px)`,
        height: `calc(100% + ${resizeDelta.dh * cellH}px)`,
      }
    : undefined

  const dragStyle: CSSProperties = {
    ...gridPositionStyle(widget),
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 30 : undefined,
  }

  return (
    <div ref={setNodeRef} style={dragStyle} className="relative min-w-0">
      <WidgetFrame
        title={widgetTitle(widget)}
        mode="arrange"
        onRemove={onRemove}
        dragAttributes={attributes}
        dragListeners={listeners}
        isDragging={isDragging}
        onResizePointerDown={handleResizePointerDown}
        onResizePointerMove={handleResizePointerMove}
        onResizePointerUp={handleResizePointerUp}
        previewStyle={previewStyle}
      >
        {children}
      </WidgetFrame>
    </div>
  )
}

/** Editable grid — dnd-kit drag-to-move + pointer-event resize. */
function ArrangeGrid({ widgets, onChange }: Omit<GridProps, 'mode'>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [colWidth, setColWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const width = el.clientWidth
      setColWidth(
        Math.max(0, (width - (GRID_COLUMNS - 1) * GRID_GAP_PX) / GRID_COLUMNS)
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    if (!colWidth) return
    const widget = widgets.find((w) => w.id === event.active.id)
    if (!widget) return

    const cellW = colWidth + GRID_GAP_PX
    const cellH = GRID_ROW_HEIGHT_PX + GRID_GAP_PX
    const dx = Math.round(event.delta.x / cellW)
    const dy = Math.round(event.delta.y / cellH)
    if (dx === 0 && dy === 0) return

    const candidate = {
      ...widget,
      x: clamp(widget.x + dx, 0, GRID_COLUMNS - widget.w),
      y: Math.max(0, widget.y + dy),
    }
    if (widgetsCollide(candidate, widgets)) return // snap back — collision rejected

    onChange(widgets.map((w) => (w.id === widget.id ? candidate : w)))
  }

  function handleResize(id: string, newW: number, newH: number) {
    const widget = widgets.find((w) => w.id === id)
    if (!widget) return

    const w = clamp(newW, MIN_WIDGET_W, GRID_COLUMNS - widget.x)
    const h = Math.max(MIN_WIDGET_H, newH)
    const candidate = { ...widget, w, h }
    if (widgetsCollide(candidate, widgets)) return // snap back — collision rejected

    onChange(widgets.map((wid) => (wid.id === id ? candidate : wid)))
  }

  function handleRemove(id: string) {
    onChange(widgets.filter((w) => w.id !== id))
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        ref={containerRef}
        className={GRID_CONTAINER_CLASS}
        style={gridContainerStyle()}
      >
        {widgets.map((widget) => (
          <ArrangeGridItem
            key={widget.id}
            widget={widget}
            colWidth={colWidth}
            onRemove={() => handleRemove(widget.id)}
            onResize={(w, h) => handleResize(widget.id, w, h)}
          >
            <WidgetContent widget={widget} />
          </ArrangeGridItem>
        ))}
      </div>
    </DndContext>
  )
}

export function Grid({ widgets, mode, onChange }: GridProps) {
  if (mode === 'view') return <ViewGrid widgets={widgets} />
  return <ArrangeGrid widgets={widgets} onChange={onChange} />
}

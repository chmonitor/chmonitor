import type { ColumnDef, RowData } from '@tanstack/react-table'

import type { ExpandableConfig, QueryConfig } from '@/types/query-config'

import { MobileSortMenu, MobileTableCards } from './mobile-table-cards'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  horizontalListSortingStrategy,
  SortableContext,
} from '@dnd-kit/sortable'
import { memo, useCallback } from 'react'
import { EXPAND_COLUMN_ID } from '@/components/data-table/column-defs'
import {
  TableBody as TableBodyRenderer,
  TableHeader as TableHeaderRenderer,
} from '@/components/data-table/renderers'
import { Table, TableBody, TableHeader } from '@/components/ui/table'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Props for the DataTableContent component
 *
 * @template TData - The row data type (extends RowData from TanStack Table)
 * @template TValue - The cell value type
 *
 * @param title - Table title for accessibility and empty state
 * @param description - Table description for accessibility
 * @param queryConfig - Query configuration defining columns, formats, sorting
 * @param table - TanStack Table instance
 * @param columnDefs - Column definitions for rendering
 * @param tableContainerRef - Ref for the table container (used for virtualization)
 * @param isVirtualized - Whether virtualization is enabled
 * @param virtualizer - Virtual row instance from useVirtualRows hook
 * @param activeFilterCount - Number of active column filters
 * @param onAutoFit - Callback when double-clicking column resizer to auto-fit
 */
export interface DataTableContentProps<
  TData extends RowData,
  TValue extends React.ReactNode,
> {
  /** Table title for accessibility and empty state */
  title: string
  /** Table description for accessibility */
  description: string | React.ReactNode
  /** Query configuration defining columns, formats, sorting */
  queryConfig: QueryConfig
  /** TanStack Table instance */
  table: import('@tanstack/react-table').Table<TData>
  /** Column definitions for rendering */
  columnDefs: ColumnDef<TData, TValue>[]
  /** Ref for the table container (used for virtualization) */
  tableContainerRef: React.RefObject<HTMLDivElement | null>
  /** Whether virtualization is enabled */
  isVirtualized: boolean
  /** Virtual row instance from useVirtualRows hook */
  virtualizer: ReturnType<
    typeof import('@/components/data-table/hooks').useVirtualRows
  >['virtualizer']
  /** Number of active column filters */
  activeFilterCount: number
  /** Callback when double-clicking column resizer to auto-fit */
  onAutoFit?: (columnId: string) => void
  /** Enable column reordering with drag-and-drop */
  enableColumnReordering?: boolean
  /** Callback when column order changes */
  onColumnOrderChange?: (activeId: string, overId: string) => void
  /** Callback to reset column order to default */
  onResetColumnOrder?: () => void
  /** Compact mode: removes borders, background, and margin */
  compact?: boolean
  /** When set, rows render an expand chevron and clicking a row toggles a detail panel below it. */
  expandable?: true | ExpandableConfig
  /**
   * When set (and `expandable` is not), clicking a row (outside interactive
   * elements) calls this with the row's data — e.g. to open a detail Sheet.
   */
  onRowClick?: (row: TData) => void
  /**
   * Active view. `'cards'`/`'table'` force that layout at every breakpoint;
   * `'auto'` (the default) is CSS-responsive — cards on mobile, table on
   * desktop.
   */
  view?: 'table' | 'cards' | 'auto'
  /** Show the table/cards toggle control above the content. */
  offerViewToggle?: boolean
  /** Callback when the user switches view. */
  onViewChange?: (view: 'table' | 'cards') => void
  /**
   * Render signature of the row-affecting table state, computed by the parent
   * (which re-renders on every controlled-state change). Because this component
   * is memoized and `table` has a stable identity, the parent MUST pass this so
   * the memo busts when state like `expanded` changes. Falls back to a local
   * computation only when omitted.
   */
  bodyRenderKey?: string
}

/**
 * DataTableContent - Content wrapper with virtualization logic
 *
 * Handles:
 * - Virtual scrolling for datasets larger than the standard pagination range
 * - Standard scrolling for smaller datasets
 * - Table header and body rendering
 * - Empty state handling with contextual messaging
 * - Accessibility with proper ARIA labels
 * - Auto-fit column sizing callback propagation
 *
 * Performance considerations:
 * - Virtualization reduces DOM nodes from thousands to ~100
 * - Memoized to prevent unnecessary re-renders
 * - Auto-enables virtualization beyond the standard pagination range
 */
export const DataTableContent = memo(function DataTableContent<
  TData extends RowData,
  TValue extends React.ReactNode,
>({
  title,
  description,
  queryConfig,
  table,
  columnDefs,
  tableContainerRef,
  isVirtualized,
  virtualizer,
  activeFilterCount,
  onAutoFit,
  enableColumnReordering = true,
  onColumnOrderChange,
  onResetColumnOrder: _onResetColumnOrder,
  compact = false,
  expandable,
  onRowClick,
  view = 'auto',
  offerViewToggle = false,
  onViewChange: _onViewChange,
  bodyRenderKey,
}: DataTableContentProps<TData, TValue>) {
  const cardsOnly = view === 'cards'
  // Visibility per layout. Both 'auto' and 'cards' show the card grid;
  // only an explicit 'table' choice shows the table.
  const cardsVisibility =
    view === 'table' ? 'hidden' : view === 'cards' ? 'block' : 'sm:hidden block'

  const tableVisibility =
    view === 'table' ? 'block' : view === 'cards' ? 'hidden' : 'sm:block hidden'
  // Configure drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag (prevents accidental drags)
      },
    })
  )

  // Handle drag end event for column reordering
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        onColumnOrderChange?.(String(active.id), String(over.id))
      }
    },
    [onColumnOrderChange]
  )

  // Extract column IDs for SortableContext.
  // Exclude utility columns (__expand chevron, selection checkbox) — they are
  // pinned to the left and must not be drag-reordered.
  const columnIds = table
    .getAllLeafColumns()
    .map((col) => col.id)
    .filter((id) => id !== EXPAND_COLUMN_ID && id !== 'select')

  // The memoized body reads row output from the stable `table` instance, so it
  // needs an explicit signal to re-render when that output changes. The parent
  // (DataTable) computes this from its controlled state and passes it in — that
  // matters because THIS component is memoized: state like `expanded` does not
  // change any prop here, so without the parent-provided key the memo would
  // never bust and expansion (chevron + detail row) would silently no-op.
  // The local computation is only a fallback for callers that don't pass it.
  const bodyState = table.getState()
  const resolvedRenderKey =
    bodyRenderKey ??
    JSON.stringify([
      bodyState.sorting,
      bodyState.pagination,
      bodyState.expanded,
      bodyState.columnSizing,
      bodyState.columnOrder,
      bodyState.columnVisibility,
      bodyState.rowSelection,
    ])

  const tableContent = (
    <Table
      aria-describedby="table-description"
      style={{ width: table.getTotalSize(), minWidth: '100%' }}
      // Force re-render when column order changes
      key={table.getState().columnOrder.join(',')}
    >
      <caption id="table-description" className="sr-only">
        {description || queryConfig.description || `${title} data table`}
      </caption>
      <TableHeader className="bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <TableHeaderRenderer
          headerGroups={table.getHeaderGroups()}
          onAutoFit={onAutoFit}
          enableColumnReordering={enableColumnReordering}
          compact={compact}
        />
      </TableHeader>
      <TableBody>
        <TableBodyRenderer
          table={table}
          columnDefs={columnDefs}
          isVirtualized={isVirtualized}
          virtualizer={virtualizer}
          title={title}
          activeFilterCount={activeFilterCount}
          rowClassName={queryConfig.rowClassName}
          expandable={expandable}
          onRowClick={onRowClick}
          renderKey={resolvedRenderKey}
        />
      </TableBody>
    </Table>
  )

  return (
    <TooltipProvider>
      <div className="relative min-w-0">
        <div
          ref={tableContainerRef}
          className={cn(
            'min-h-0 min-w-0',
            isVirtualized ? 'flex-1 overflow-auto' : 'w-full overflow-x-auto',
            {
              'max-h-[50vh]': compact && !isVirtualized,
              'mb-5 border border-border/50 bg-card/30': !compact && !cardsOnly,
            }
          )}
          role="region"
          aria-label={`${title || 'Data'} table`}
          style={isVirtualized ? { height: '60vh' } : undefined}
        >
          {/* Card layout: on mobile by default, and at all widths when view==='cards'. */}
          {!compact && (
            <div className={cn('p-3', cardsVisibility)}>
              {!offerViewToggle && (
                <div className="mb-2 flex justify-end">
                  <MobileSortMenu table={table} />
                </div>
              )}
              <MobileTableCards
                table={table}
                title={title}
                activeFilterCount={activeFilterCount}
                rowClassName={queryConfig.rowClassName}
                isVirtualized={isVirtualized}
                virtualizer={virtualizer}
                expandable={expandable}
                card={queryConfig.card}
                columnIcons={queryConfig.columnIcons}
                view={view}
              />
            </div>
          )}
          <div className={cn('min-w-0', compact ? undefined : tableVisibility)}>
            {enableColumnReordering ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToHorizontalAxis]}
              >
                <SortableContext
                  items={columnIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {tableContent}
                </SortableContext>
              </DndContext>
            ) : (
              tableContent
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}) as <TData extends RowData, TValue extends React.ReactNode>(
  props: DataTableContentProps<TData, TValue>
) => React.JSX.Element

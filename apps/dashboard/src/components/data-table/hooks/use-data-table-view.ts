import type {
  ColumnOrderState,
  Row,
  RowData,
  Table,
} from '@tanstack/react-table'

import type { TableFilterCondition } from './use-filtered-data'

import { useAutoFitColumns } from './use-auto-fit-columns'
import { useVirtualRows } from './use-virtual-rows'
import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useState } from 'react'
import { computeTableBodyRenderKey } from '@/components/data-table/utils/body-render-key'

interface UseDataTableViewParams<TData extends RowData> {
  table: Table<TData>
  defaultView: 'table' | 'cards' | 'auto' | undefined
  expandable: unknown
  onColumnOrderChange: (order: ColumnOrderState) => void
  globalSearch: string
  advancedFilters: TableFilterCondition[]
}

/**
 * Card/table view toggle, virtualization, auto-fit-column, and drag-reorder
 * wiring for `DataTable`. These are the pieces that depend on the already-
 * constructed TanStack `table` instance (unlike the state hooks that feed
 * into `useDataTableInstance`), so they compose here as one "view" layer.
 */
export function useDataTableView<TData extends RowData>({
  table,
  defaultView,
  expandable,
  onColumnOrderChange,
  globalSearch,
  advancedFilters,
}: UseDataTableViewParams<TData>) {
  // Card vs. table view. Only offered (with a toolbar toggle) when the config
  // opts in via `defaultView`; otherwise tables behave exactly as before.
  //
  // The effective view is `'auto'` (CSS-responsive: cards on mobile, table on
  // desktop — the historical default) until the user explicitly picks one with
  // the toggle. Once picked, that choice applies at every breakpoint, so phone
  // users can switch a card list back to the full table and vice versa.
  const offerViewToggle = defaultView !== undefined
  const [userView, setUserView] = useState<'table' | 'cards' | null>(null)
  const baseView: 'table' | 'cards' | 'auto' = defaultView ?? 'auto'
  const view = userView ?? baseView

  // Virtual rows for datasets larger than the standard pagination range.
  // Disabled when row expansion is on because expanded rows add out-of-band
  // height the fixed-size virtualizer can't account for.
  const rows: Row<TData>[] = table.getRowModel().rows
  const { virtualizer, tableContainerRef, isVirtualized } = useVirtualRows(
    rows.length,
    { disabled: Boolean(expandable) || view === 'cards' }
  )

  // Auto-fit columns functionality
  const { autoFitColumn } = useAutoFitColumns<TData>(tableContainerRef)

  // Handle auto-fit request for a specific column
  const handleAutoFit = useCallback(
    (columnId: string) => {
      const column = table.getColumn(columnId)
      if (!column) return

      const headerText = column.columnDef.header as string
      autoFitColumn(column, rows, headerText)
    },
    [table, rows, autoFitColumn]
  )

  // Handle drag end event for column reordering
  // This is called by table-header when columns are reordered via drag-and-drop
  const handleDragEndColumnReorder = useCallback(
    (activeId: string, overId: string) => {
      const currentOrder = table.getState().columnOrder

      // Get ALL columns from the table (not just sortable ones)
      const allColumnIds = table.getAllLeafColumns().map((col) => col.id)

      // Use currentOrder if it has values, otherwise use all columns in natural order
      const effectiveOrder =
        currentOrder.length > 0 ? currentOrder : allColumnIds

      const oldIndex = effectiveOrder.indexOf(activeId)
      const newIndex = effectiveOrder.indexOf(overId)

      if (oldIndex !== -1 && newIndex !== -1) {
        // Reorder ALL columns, not just the sortable ones
        const newOrder = arrayMove(effectiveOrder, oldIndex, newIndex)
        onColumnOrderChange(newOrder)
      }
    },
    [table, onColumnOrderChange]
  )

  // Render signature for the memoized table body. Computed HERE (not inside the
  // memoized DataTableContent) because DataTable re-renders on every controlled
  // state change (sorting, expanded, columnSizing, rowSelection, ...) whereas
  // DataTableContent's props are otherwise stable — so a state change like
  // `expanded` would never reach the memo and row expansion would silently
  // no-op. Passing this down guarantees the body memo busts when rows change.
  const tableState = table.getState()
  const bodyRenderKey = computeTableBodyRenderKey({
    sorting: tableState.sorting,
    pagination: tableState.pagination,
    expanded: tableState.expanded,
    columnSizing: tableState.columnSizing,
    columnOrder: tableState.columnOrder,
    columnVisibility: tableState.columnVisibility,
    rowSelection: tableState.rowSelection,
    globalSearch,
    advancedFilters,
  })

  return {
    offerViewToggle,
    view,
    setUserView,
    virtualizer,
    tableContainerRef,
    isVirtualized,
    handleAutoFit,
    handleDragEndColumnReorder,
    bodyRenderKey,
  }
}

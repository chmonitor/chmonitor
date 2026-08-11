import {
  type ColumnDef,
  type ColumnOrderState,
  type ColumnResizeMode,
  type ColumnSizingState,
  type ExpandedState,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type RowData,
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'

import type { ExpandableConfig } from '@/types/query-config'

import { useCallback, useMemo, useState } from 'react'
import {
  buildExpandColumnDef,
  EXPAND_COLUMN_ID,
} from '@/components/data-table/column-defs'
import { getCustomSortingFns } from '@/components/data-table/sorting-fns'
import { Checkbox } from '@/components/ui/checkbox'

interface UseDataTableInstanceParams<TData extends RowData, TValue> {
  data: TData[]
  columnDefs: ColumnDef<TData, TValue>[]
  expandable: true | ExpandableConfig | undefined
  enableRowSelection: boolean
  defaultPageSize: number
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  initialColumnVisibility: VisibilityState
  columnSizing: ColumnSizingState
  onColumnSizingChange: OnChangeFn<ColumnSizingState>
  enableColumnResizing: boolean
  columnResizeMode: ColumnResizeMode
  enableSorting: boolean
  columnOrder: ColumnOrderState
  onColumnOrderChange: OnChangeFn<ColumnOrderState>
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
}

/**
 * Composes the special utility columns (row-expand chevron, selection
 * checkbox) with the data columns, builds the TanStack Table instance, and
 * owns the table-native state (sorting, expanded) that isn't already owned by
 * a sibling hook (column visibility/sizing/order, row selection — all passed
 * in so this hook stays a pure composition point).
 */
export function useDataTableInstance<
  TData extends RowData,
  TValue extends React.ReactNode,
>({
  data,
  columnDefs,
  expandable,
  enableRowSelection,
  defaultPageSize,
  columnVisibility,
  onColumnVisibilityChange,
  initialColumnVisibility,
  columnSizing,
  onColumnSizingChange,
  enableColumnResizing,
  columnResizeMode,
  enableSorting,
  columnOrder,
  onColumnOrderChange,
  rowSelection,
  onRowSelectionChange,
}: UseDataTableInstanceParams<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])

  // Selection column definition using TanStack Table's row selection
  const selectionColumn: ColumnDef<TData, unknown> = {
    id: 'select',
    header: ({ table }) => {
      const isAllSelected = table.getIsAllPageRowsSelected()
      const isSomeSelected = table.getIsSomePageRowsSelected()
      return (
        <div
          role="presentation"
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isAllSelected}
            indeterminate={isSomeSelected && !isAllSelected}
            onCheckedChange={(checked) =>
              table.toggleAllPageRowsSelected(checked === true)
            }
            onClick={(e) => e.stopPropagation()}
            aria-label="Select all rows"
          />
        </div>
      )
    },
    cell: ({ row }) => (
      <div
        role="presentation"
        className="flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    size: 48,
    minSize: 48,
    maxSize: 48,
  }

  // Expand chevron column (inserted at the very left when expansion is on)
  const expandColumn = buildExpandColumnDef<TData, TValue>()

  // Combine special columns with data columns:
  // [expand?, select?, ...columnDefs]
  // Memoized so the array reference is stable across re-renders caused by data
  // refetches — without this, TanStack Table sees a new columns array every
  // render and remounts cells, causing visible flash.
  // biome-ignore lint/correctness/useExhaustiveDependencies: expandColumn/selectionColumn are recreated each render; including them would defeat the memo
  const finalColumnDefs = useMemo(() => {
    const cols: ColumnDef<TData, unknown>[] = []
    if (expandable) cols.push(expandColumn as ColumnDef<TData, unknown>)
    if (enableRowSelection) cols.push(selectionColumn)
    return [
      ...cols,
      ...(columnDefs as ColumnDef<TData, unknown>[]),
    ] as ColumnDef<TData, TValue>[]
  }, [columnDefs, expandable, enableRowSelection])

  // Compose the effective column order. Saved orders in localStorage only
  // contain data columns (predating utility columns like `__expand`/`select`),
  // so we always pin utility column IDs to the very front and strip any
  // duplicates that may appear later in the saved order. When no saved order
  // exists, returning `[]` lets TanStack derive order from `finalColumnDefs`.
  const finalColumnOrder = useMemo((): ColumnOrderState => {
    const utilityIds: string[] = []
    if (expandable) utilityIds.push(EXPAND_COLUMN_ID)
    if (enableRowSelection) utilityIds.push('select')
    if (columnOrder.length === 0) return utilityIds.length ? utilityIds : []
    const dataOnly = columnOrder.filter((id) => !utilityIds.includes(id))
    return [...utilityIds, ...dataOnly]
  }, [expandable, enableRowSelection, columnOrder])

  // Row expansion state. When `expandable.defaultExpanded` is true we expand
  // everything by default; the user can collapse individually.
  const initialExpanded: ExpandedState = (() => {
    if (
      expandable &&
      typeof expandable === 'object' &&
      expandable.defaultExpanded
    ) {
      return true
    }
    return {}
  })()
  const [expanded, setExpanded] = useState<ExpandedState>(initialExpanded)

  // Generate unique row ID from data (use query_id if available, otherwise index)
  // Memoized: the body captures nothing, so a stable reference avoids feeding
  // useReactTable a new getRowId every render (which would bust its row models).
  const getRowId = useCallback((row: TData, index: number) => {
    const record = row as Record<string, unknown>
    // Try common ID fields first
    if (record.query_id) return String(record.query_id)
    if (record.id) return String(record.id)
    // Fallback to index
    return String(index)
  }, [])

  // Custom sorting functions capture nothing, so build them once per instance
  // instead of allocating a fresh object on every render.
  const customSortingFns = useMemo(() => getCustomSortingFns<TData>(), [])

  const table = useReactTable({
    data,
    columns: finalColumnDefs,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    // Add custom sorting functions
    // Ref: https://tanstack.com/table/v8/docs/guide/sorting#custom-sorting-functions
    sortingFns: customSortingFns,
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange,
    // Column resizing (configurable via queryConfig.tableBehavior)
    enableColumnResizing,
    columnResizeMode,
    onColumnSizingChange,
    // Column reordering
    onColumnOrderChange,
    // Row selection - pass true to enable for all rows
    enableRowSelection: !!enableRowSelection,
    getRowId,
    onRowSelectionChange,
    // Sorting (configurable via queryConfig.tableBehavior)
    enableSorting,
    // Inline row expansion (only enabled when the QueryConfig opts in)
    enableExpanding: !!expandable,
    getRowCanExpand: () => !!expandable,
    getExpandedRowModel: getExpandedRowModel(),
    onExpandedChange: setExpanded,
    // Default column sizing so getSize() returns sensible values for layout
    // even when no explicit columnSizing hint exists. Without this, resizing
    // appears "broken" because TanStack's default size (150) is identical to
    // the natural fit on most short headers.
    defaultColumn: {
      size: 180,
      minSize: 60,
      maxSize: 800,
    },
    state: {
      sorting,
      columnVisibility,
      columnSizing,
      rowSelection,
      columnOrder: finalColumnOrder,
      expanded,
    },
    initialState: {
      pagination: {
        pageSize: defaultPageSize,
      },
      columnVisibility: initialColumnVisibility,
    },
  })

  return { table, finalColumnDefs, sorting, expanded }
}

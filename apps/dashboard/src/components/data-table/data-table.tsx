import {
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type ExpandedState,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
  useReactTable,
} from '@tanstack/react-table'

import type { ApiResponseMetadata } from '@/lib/api/types'
import type { ChartQueryParams } from '@/types/chart-data'
import type { ExpandableConfig, QueryConfig } from '@/types/query-config'

import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useMemo, useState } from 'react'
import {
  buildExpandColumnDef,
  EXPAND_COLUMN_ID,
  normalizeColumnName,
  type SchemaColumnFilterContext,
} from '@/components/data-table/column-defs'
import {
  DataTableContent,
  DataTableFooter,
  DataTableHeader,
} from '@/components/data-table/components'
import { TableDensityProvider } from '@/components/data-table/context/table-density-context'
import { useColumnFilterState } from '@/components/data-table/filters/use-column-filter-state'
import {
  type TableFilterCondition,
  useAutoFitColumns,
  useColumnVisibility,
  useFilteredData,
  useTableColumns,
  useTableDensity,
  useTableFilters,
  useVirtualRows,
} from '@/components/data-table/hooks'
import { getCustomSortingFns } from '@/components/data-table/sorting-fns'
import { computeTableBodyRenderKey } from '@/components/data-table/utils/body-render-key'
import { resolveTableBehavior } from '@/components/data-table/utils/resolve-table-behavior'
import { FilterBar } from '@/components/filters/filter-bar'
import { Checkbox } from '@/components/ui/checkbox'
import { useSearchParams } from '@/lib/next-compat'
import { cn } from '@/lib/utils'

/**
 * Props for the DataTable component
 *
 * @template TData - The row data type (extends RowData from TanStack Table)
 *
 * @param title - Table title displayed in header
 * @param description - Table description or subtitle
 * @param toolbarExtras - Additional toolbar elements (left side)
 * @param topRightToolbarExtras - Additional toolbar elements (right side)
 * @param queryConfig - Query configuration defining columns, formats, sorting
 * @param apiParams - Parameters passed to API for query execution (deprecated: use queryParams)
 * @param queryParams - Parameters for query execution (search, sort, pagination)
 * @param data - Array of row data to display
 * @param context - Template replacement context for links (e.g., { database: 'system' })
 * @param defaultPageSize - Initial page size (default: 100)
 * @param showSQL - Show SQL button visibility (default: true)
 * @param footnote - Custom footnote content
 * @param className - Additional CSS classes for container
 * @param enableColumnFilters - Enable client-side column text filtering (default: false)
 * @param enableFilterUrlSync - Sync filters to URL parameters for shareable links (default: false)
 * @param filterUrlPrefix - URL parameter prefix for filters (default: 'filter')
 * @param filterableColumns - Columns to enable filtering for (default: all text columns)
 * @param isRefreshing - Show loading indicator in header when refreshing data
 */
interface DataTableProps<TData extends RowData> {
  /** Table title displayed in header */
  title?: string
  /** Table description or subtitle */
  description?: string | React.ReactNode
  /** Additional toolbar elements (left side) */
  toolbarExtras?: React.ReactNode
  /** Additional toolbar elements (right side) */
  topRightToolbarExtras?: React.ReactNode
  /** Query configuration defining columns, formats, sorting */
  queryConfig: QueryConfig
  /** @deprecated Use queryParams instead */
  queryParams?: ChartQueryParams
  /** Parameters for query execution (search, sort, pagination) */
  apiParams?: ChartQueryParams
  /** Array of row data to display */
  data: TData[]
  /** Template replacement context for links (e.g., { database: 'system', table: 'users' }) */
  context: Record<string, string>
  /** Initial page size (default: 100) */
  defaultPageSize?: number
  /** Show SQL button visibility (default: true) */
  showSQL?: boolean
  /** Custom footnote content */
  footnote?: string | React.ReactNode
  /** Additional CSS classes for container */
  className?: string
  /** Enable client-side column text filtering (default: false) */
  enableColumnFilters?: boolean
  /** Sync filters to URL parameters for shareable links (default: false) */
  enableFilterUrlSync?: boolean
  /** URL parameter prefix for filters (default: 'filter') */
  filterUrlPrefix?: string
  /** Columns to enable filtering for (default: all text columns) */
  filterableColumns?: string[]
  /** Show loading indicator in header when refreshing data */
  isRefreshing?: boolean
  /** The actual SQL that was executed (after version selection) */
  executedSql?: string
  /** Enable row selection with checkboxes (default: false) */
  enableRowSelection?: boolean
  /** Callback when row selection changes */
  onRowSelectionChange?: (selectedRows: RowSelectionState) => void
  /** Query execution metadata */
  metadata?: Partial<ApiResponseMetadata>
  /** Enable column reordering with drag-and-drop (default: true) */
  enableColumnReordering?: boolean
  /** Storage key for persisting column order to localStorage */
  columnOrderStorageKey?: string
  /** Compact mode: hides header/toolbar, removes borders, forces dense density (default: false) */
  compact?: boolean
  /**
   * Inline row expansion. When set, each row renders a chevron and a click on
   * the row (outside interactive children) toggles a full-width detail panel.
   * Overrides `queryConfig.expandable`.
   */
  expandable?: true | ExpandableConfig
  /**
   * When set (and `expandable` is not), clicking a row (outside interactive
   * elements) calls this with the row's data — e.g. to open a detail Sheet.
   * Desktop table rows only; the mobile card view does not yet support this.
   */
  onRowClick?: (row: TData) => void
  /**
   * Render the schema-driven filter bar above the table when a `filterSchema`
   * is present on the QueryConfig. Defaults to true.
   */
  showFilterBar?: boolean
}

/**
 * DataTable - Main data table component with sorting, filtering, virtualization
 *
 * High-level orchestrator that delegates rendering to specialized sub-components:
 * - DataTableHeader: Title, toolbar, column visibility controls
 * - DataTableContent: Table with virtualization support
 * - DataTableFooter: Pagination and footnote
 *
 * Features:
 * - Virtual scrolling for datasets larger than the standard pagination range
 * - Client-side column filtering
 * - URL filter synchronization for shareable links
 * - Custom sorting functions
 * - Column visibility controls
 * - Responsive design with shadcn/ui components
 *
 * Performance optimizations:
 * - Memoized sub-components prevent unnecessary re-renders
 * - Virtualization reduces DOM nodes from thousands to ~100
 * - Efficient column calculations with useMemo
 */
export function DataTable<
  TData extends RowData,
  TValue extends React.ReactNode,
>({
  title = '',
  description = '',
  toolbarExtras,
  topRightToolbarExtras,
  queryConfig,
  queryParams: _deprecatedQueryParams,
  apiParams: _apiParams,
  data,
  context,
  defaultPageSize = 100,
  showSQL = true,
  footnote,
  className,
  enableColumnFilters = false,
  enableFilterUrlSync = false,
  filterUrlPrefix = 'filter',
  filterableColumns,
  isRefreshing = false,
  executedSql,
  enableRowSelection = false,
  onRowSelectionChange,
  metadata,
  enableColumnReordering: enableColumnReorderingProp,
  columnOrderStorageKey,
  compact = false,
  expandable: expandableProp,
  onRowClick,
  showFilterBar = true,
}: DataTableProps<TData>) {
  // Resolve expansion config: explicit prop wins over QueryConfig declaration
  const expandable = expandableProp ?? queryConfig.expandable

  // Check if schema-driven filter bar has active URL filters (q param or field keys)
  const searchParams = useSearchParams()
  const hasActiveSchemaFilters = Boolean(
    queryConfig.filterSchema &&
      (searchParams.get('q') ||
        queryConfig.filterSchema.fields?.some((field) =>
          searchParams.has(field.key)
        ))
  )

  const {
    enableColumnResizing: resolvedEnableColumnResizing,
    columnResizeMode: resolvedColumnResizeMode,
    enableSorting: resolvedEnableSorting,
    enableColumnReordering: resolvedEnableColumnReordering,
  } = resolveTableBehavior({ queryConfig, enableColumnReorderingProp })

  const [globalSearch, setGlobalSearch] = useState('')
  const [advancedFilters, setAdvancedFilters] = useState<
    TableFilterCondition[]
  >([])

  // Determine which columns should be filterable (memoized)
  const configuredColumns = useMemo(
    () => queryConfig.columns.map(normalizeColumnName),
    [queryConfig.columns]
  )

  // Client-side column filtering state with optional URL sync
  const {
    columnFilters,
    setColumnFilter,
    clearColumnFilter,
    clearAllColumnFilters: _clearAllColumnFilters,
    activeFilterCount,
  } = useTableFilters({
    enableUrlSync: enableFilterUrlSync,
    urlPrefix: filterUrlPrefix,
  })

  // Apply client-side filters when enabled
  const filteredData = useFilteredData({
    data,
    enableColumnFilters,
    columnFilters,
    globalSearch,
    advancedFilters,
  })

  // Memoize filterableColumns to prevent filterContext recreation
  const resolvedFilterableColumns = useMemo(
    () => filterableColumns || configuredColumns,
    [filterableColumns, configuredColumns]
  )

  // Memoize filter context to prevent columnDefs recreation on every render
  // This is critical to avoid infinite loops when filters change.
  // setColumnFilter/clearColumnFilter are stable (useCallback in useTableFilters).
  const filterContext = useMemo(
    () =>
      enableColumnFilters
        ? {
            enableColumnFilters,
            filterableColumns: resolvedFilterableColumns,
            columnFilters,
            setColumnFilter,
            clearColumnFilter,
          }
        : undefined,
    [
      enableColumnFilters,
      resolvedFilterableColumns,
      columnFilters,
      setColumnFilter,
      clearColumnFilter,
    ]
  )

  // Schema-driven typed column filter wiring (date-range, multi-select, etc.)
  const { getActiveFilter, setFilter, clearFilter } = useColumnFilterState(
    queryConfig.filterSchema
  )
  const schemaFilterContext = useMemo(
    (): SchemaColumnFilterContext | undefined =>
      queryConfig.filterSchema && queryConfig.columnFilters
        ? {
            schema: queryConfig.filterSchema,
            configName: queryConfig.name,
            getActiveFilter,
            setFilter,
            clearFilter,
          }
        : undefined,
    [
      queryConfig.filterSchema,
      queryConfig.columnFilters,
      queryConfig.name,
      getActiveFilter,
      setFilter,
      clearFilter,
    ]
  )

  // Column calculations and definitions
  const { columnDefs } = useTableColumns<TData, TValue>({
    queryConfig,
    context,
    data,
    filteredData,
    filterContext,
    schemaFilterContext,
  })

  // Column visibility
  const { columnVisibility, setColumnVisibility, initialColumnVisibility } =
    useColumnVisibility({
      configuredColumns,
    })

  // Density mode with localStorage persistence
  const { density, setDensity, cellClassName } = useTableDensity(
    compact ? 'compact' : undefined
  )

  // Sorting
  const [sorting, setSorting] = useState<SortingState>([])

  // Column sizing for resize support
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})

  // Column ordering for drag-and-drop reordering (with optional localStorage persistence)
  const getStorageKey = useCallback(
    () =>
      `data-table-column-order-${columnOrderStorageKey || queryConfig.name}`,
    [columnOrderStorageKey, queryConfig.name]
  )
  const initialColumnOrder = (() => {
    if (resolvedEnableColumnReordering && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(getStorageKey())
        if (saved) return JSON.parse(saved) as ColumnOrderState
      } catch {
        // Ignore localStorage errors
      }
    }
    return []
  })()

  const [columnOrder, setColumnOrder] =
    useState<ColumnOrderState>(initialColumnOrder)

  // Persist column order to localStorage when it changes
  // This handles both direct values and updater functions from TanStack Table
  const handleColumnOrderChange = useCallback(
    (
      updaterOrValue:
        | ColumnOrderState
        | ((old: ColumnOrderState) => ColumnOrderState)
    ) => {
      // Update both React state and TanStack Table's state
      setColumnOrder(updaterOrValue)

      // Save to localStorage
      if (resolvedEnableColumnReordering && typeof window !== 'undefined') {
        const newOrder =
          typeof updaterOrValue === 'function'
            ? (updaterOrValue as (old: ColumnOrderState) => ColumnOrderState)(
                columnOrder
              )
            : updaterOrValue
        try {
          localStorage.setItem(getStorageKey(), JSON.stringify(newOrder))
        } catch {
          // Ignore localStorage errors
        }
      }
    },
    [columnOrder, resolvedEnableColumnReordering, getStorageKey]
  )

  // Row selection state
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const handleRowSelectionChange = (
    updaterOrValue: Updater<RowSelectionState>
  ) => {
    setRowSelection((current) => {
      const next =
        typeof updaterOrValue === 'function'
          ? updaterOrValue(current)
          : updaterOrValue
      onRowSelectionChange?.(next)
      return next
    })
  }

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
            checked={
              isSomeSelected && !isAllSelected ? 'indeterminate' : isAllSelected
            }
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
    data: filteredData,
    columns: finalColumnDefs,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    // Add custom sorting functions
    // Ref: https://tanstack.com/table/v8/docs/guide/sorting#custom-sorting-functions
    sortingFns: customSortingFns,
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    // Column resizing (configurable via queryConfig.tableBehavior)
    enableColumnResizing: resolvedEnableColumnResizing,
    columnResizeMode: resolvedColumnResizeMode,
    onColumnSizingChange: setColumnSizing,
    // Column reordering
    onColumnOrderChange: handleColumnOrderChange,
    // Row selection - pass true to enable for all rows
    enableRowSelection: !!enableRowSelection,
    getRowId,
    onRowSelectionChange: handleRowSelectionChange,
    // Sorting (configurable via queryConfig.tableBehavior)
    enableSorting: resolvedEnableSorting,
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

  // Card vs. table view. Only offered (with a toolbar toggle) when the config
  // opts in via `defaultView`; otherwise tables behave exactly as before.
  //
  // The effective view is `'auto'` (CSS-responsive: cards on mobile, table on
  // desktop — the historical default) until the user explicitly picks one with
  // the toggle. Once picked, that choice applies at every breakpoint, so phone
  // users can switch a card list back to the full table and vice versa.
  const offerViewToggle = queryConfig.defaultView !== undefined
  const [userView, setUserView] = useState<'table' | 'cards' | null>(null)
  const baseView: 'table' | 'cards' | 'auto' = queryConfig.defaultView ?? 'auto'
  const view = userView ?? baseView

  // Virtual rows for datasets larger than the standard pagination range.
  // Disabled when row expansion is on because expanded rows add out-of-band
  // height the fixed-size virtualizer can't account for.
  const rows = table.getRowModel().rows
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
        handleColumnOrderChange(newOrder)
      }
    },
    [table, handleColumnOrderChange]
  )

  // Reset column order to default (empty array means use natural order)
  const handleResetColumnOrder = useCallback(() => {
    handleColumnOrderChange([])
    if (resolvedEnableColumnReordering && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(getStorageKey())
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [handleColumnOrderChange, resolvedEnableColumnReordering, getStorageKey])

  return (
    <TableDensityProvider value={{ cellClassName, density }}>
      <div className={cn('flex min-w-0 flex-col overflow-hidden', className)}>
        {!compact && (
          <DataTableHeader
            title={title}
            description={description}
            queryConfig={queryConfig}
            toolbarExtras={toolbarExtras}
            topRightToolbarExtras={topRightToolbarExtras}
            showSQL={showSQL}
            table={table}
            isRefreshing={isRefreshing}
            executedSql={executedSql}
            metadata={metadata}
            enableColumnReordering={resolvedEnableColumnReordering}
            onResetColumnOrder={handleResetColumnOrder}
            density={density}
            onDensityChange={setDensity}
            globalSearch={globalSearch}
            onGlobalSearchChange={setGlobalSearch}
            advancedFilters={advancedFilters}
            onAdvancedFiltersChange={setAdvancedFilters}
            filterBarSlot={
              !compact &&
              showFilterBar &&
              queryConfig.filterSchema &&
              (data.length > 0 || hasActiveSchemaFilters) ? (
                <FilterBar queryConfig={queryConfig} />
              ) : undefined
            }
            offerViewToggle={offerViewToggle}
            view={view}
            onViewChange={setUserView}
          />
        )}

        <DataTableContent
          title={title}
          description={description}
          queryConfig={queryConfig}
          table={table}
          columnDefs={finalColumnDefs}
          tableContainerRef={tableContainerRef}
          isVirtualized={isVirtualized}
          virtualizer={virtualizer}
          activeFilterCount={activeFilterCount}
          onAutoFit={handleAutoFit}
          enableColumnReordering={resolvedEnableColumnReordering}
          onColumnOrderChange={handleDragEndColumnReorder}
          onResetColumnOrder={handleResetColumnOrder}
          compact={compact}
          expandable={expandable}
          onRowClick={onRowClick}
          view={view}
          offerViewToggle={offerViewToggle}
          onViewChange={setUserView}
          bodyRenderKey={bodyRenderKey}
        />

        <DataTableFooter table={table} footnote={footnote} compact={compact} />
      </div>
    </TableDensityProvider>
  )
}

export { EXPAND_COLUMN_ID }

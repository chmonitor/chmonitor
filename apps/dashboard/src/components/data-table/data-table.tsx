import type { RowData } from '@tanstack/react-table'

import type { DataTableProps } from '@/components/data-table/data-table.types'

import { EXPAND_COLUMN_ID } from '@/components/data-table/column-defs'
import {
  DataTableContent,
  DataTableFooter,
  DataTableHeader,
} from '@/components/data-table/components'
import { TableDensityProvider } from '@/components/data-table/context/table-density-context'
import {
  useColumnOrderState,
  useColumnSizing,
  useColumnVisibility,
  useDataTableFiltering,
  useDataTableInstance,
  useDataTableView,
  useRowSelectionState,
  useTableColumns,
  useTableDensity,
} from '@/components/data-table/hooks'
import { resolveTableBehavior } from '@/components/data-table/utils/resolve-table-behavior'
import { FilterBar } from '@/components/filters/filter-bar'
import { useSearchParams } from '@/lib/next-compat'
import { cn } from '@/lib/utils'

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

  // Global search, advanced/column filters, and the resulting filtered data +
  // filter-context objects handed to the column-def builders.
  const {
    globalSearch,
    setGlobalSearch,
    advancedFilters,
    setAdvancedFilters,
    configuredColumns,
    filteredData,
    filterContext,
    schemaFilterContext,
    activeFilterCount,
  } = useDataTableFiltering({
    queryConfig,
    data,
    enableColumnFilters,
    enableFilterUrlSync,
    filterUrlPrefix,
    filterableColumns,
  })

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

  // Column sizing for resize support
  const { columnSizing, setColumnSizing } = useColumnSizing()

  // Column ordering for drag-and-drop reordering (with optional localStorage persistence)
  const { columnOrder, handleColumnOrderChange, resetColumnOrder } =
    useColumnOrderState({
      columnOrderStorageKey,
      queryConfigName: queryConfig.name,
      enabled: resolvedEnableColumnReordering,
    })

  // Row selection state
  const { rowSelection, handleRowSelectionChange } =
    useRowSelectionState(onRowSelectionChange)

  // Composes the utility columns (expand/select) with the data columns and
  // builds the TanStack Table instance.
  const { table, finalColumnDefs } = useDataTableInstance<TData, TValue>({
    data: filteredData,
    columnDefs,
    expandable,
    enableRowSelection,
    defaultPageSize,
    columnVisibility,
    onColumnVisibilityChange: setColumnVisibility,
    initialColumnVisibility,
    columnSizing,
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: resolvedEnableColumnResizing,
    columnResizeMode: resolvedColumnResizeMode,
    enableSorting: resolvedEnableSorting,
    columnOrder,
    onColumnOrderChange: handleColumnOrderChange,
    rowSelection,
    onRowSelectionChange: handleRowSelectionChange,
  })

  // Card/table view toggle, virtualization, auto-fit-column, and the
  // drag-reorder + body-render-key wiring that depend on the `table` instance.
  const {
    offerViewToggle,
    view,
    setUserView,
    virtualizer,
    tableContainerRef,
    isVirtualized,
    handleAutoFit,
    handleDragEndColumnReorder,
    bodyRenderKey,
  } = useDataTableView<TData>({
    table,
    defaultView: queryConfig.defaultView,
    expandable,
    onColumnOrderChange: handleColumnOrderChange,
    globalSearch,
    advancedFilters,
  })

  // Reset column order to default (empty array means use natural order)
  const handleResetColumnOrder = resetColumnOrder

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

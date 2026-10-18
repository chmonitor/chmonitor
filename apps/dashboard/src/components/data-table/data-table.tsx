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
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { cn } from '@/lib/utils'

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
  embedded = false,
  expandable: expandableProp,
  onRowClick,
  showFilterBar = true,
}: DataTableProps<TData>) {
  const expandable = expandableProp ?? queryConfig.expandable

  const searchParams = useUrlSearchParams()
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

  const { columnDefs } = useTableColumns<TData, TValue>({
    queryConfig,
    context,
    data,
    filteredData,
    filterContext,
    schemaFilterContext,
  })

  const { columnVisibility, setColumnVisibility, initialColumnVisibility } =
    useColumnVisibility({
      configuredColumns,
    })

  const { density, setDensity, cellClassName } = useTableDensity(
    compact ? 'compact' : undefined
  )

  const { columnSizing, setColumnSizing } = useColumnSizing()

  const { columnOrder, handleColumnOrderChange, resetColumnOrder } =
    useColumnOrderState({
      columnOrderStorageKey,
      queryConfigName: queryConfig.name,
      enabled: resolvedEnableColumnReordering,
    })

  const { rowSelection, handleRowSelectionChange } =
    useRowSelectionState(onRowSelectionChange)

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
            embedded={embedded}
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
          embedded={embedded}
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

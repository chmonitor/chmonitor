import type { QueryConfig } from '@/types/query-config'

import { type TableFilterCondition, useFilteredData } from './use-filtered-data'
import { useTableFilters } from './use-table-filters'
import { useMemo, useState } from 'react'
import {
  normalizeColumnName,
  type SchemaColumnFilterContext,
} from '@/components/data-table/column-defs'
import { useColumnFilterState } from '@/components/data-table/filters/use-column-filter-state'

interface UseDataTableFilteringParams<TData> {
  queryConfig: QueryConfig
  data: TData[]
  enableColumnFilters: boolean
  enableFilterUrlSync: boolean
  filterUrlPrefix: string
  filterableColumns?: string[]
}

/**
 * Client-side filtering state for `DataTable`: the global search + advanced
 * filter conditions, URL-synced column filters (`useTableFilters`), the
 * filtered data (`useFilteredData`), and the two filter-context objects handed
 * to column-def builders (free-text `filterContext`, schema-driven
 * `schemaFilterContext`).
 */
export function useDataTableFiltering<TData>({
  queryConfig,
  data,
  enableColumnFilters,
  enableFilterUrlSync,
  filterUrlPrefix,
  filterableColumns,
}: UseDataTableFilteringParams<TData>) {
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

  return {
    globalSearch,
    setGlobalSearch,
    advancedFilters,
    setAdvancedFilters,
    configuredColumns,
    filteredData,
    filterContext,
    schemaFilterContext,
    activeFilterCount,
  }
}

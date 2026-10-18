import type { RowData } from '@tanstack/react-table'

import type { FilterDraft } from '@/components/filters/filter-editor'
import type {
  ActiveFilter,
  FilterField,
  FilterSchema,
} from '@/lib/filters/types'
import type { QueryConfig } from '@/types/query-config'

export type ColumnType = { [key: string]: string }

export interface ColumnFilterContext {
  enableColumnFilters?: boolean
  filterableColumns?: string[]
  columnFilters: Record<string, string>
  setColumnFilter: (column: string, value: string) => void
  clearColumnFilter: (column: string) => void
}

/**
 * Schema-driven per-column filter context. Lets the header render a typed
 * filter popover (date-range, multi-select, etc.) backed by the URL via
 * `filterSchema`.
 */
export interface SchemaColumnFilterContext {
  schema: FilterSchema
  configName: string
  getActiveFilter: (field: FilterField) => ActiveFilter | null
  setFilter: (key: string, draft: FilterDraft) => void
  clearFilter: (key: string) => void
}

export interface GetColumnDefsOptions<TData extends RowData> {
  config: QueryConfig
  data: TData[]
  context: Record<string, string>
  filterContext?: ColumnFilterContext
  schemaFilterContext?: SchemaColumnFilterContext
}

export interface ColumnFormatInfo {
  format: string
  options?: Record<string, unknown>
}

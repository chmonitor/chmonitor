/**
 * Column definition generator for TanStack Table
 *
 * Generates an array of column definitions based on query configuration.
 * Handles formatting, sorting, filtering, and cell rendering.
 */

import type {
  Column,
  ColumnDef,
  Row,
  RowData,
  Table,
} from '@tanstack/react-table'

import type { ColumnFormat, ColumnFormatOptions } from '@/types/column-format'
import type {
  ColumnFilterContext,
  GetColumnDefsOptions,
  SchemaColumnFilterContext,
} from './types'

import { resolveColumnFilterField } from '../filters/column-filter-bridge'
import { ExpandChevron } from '../row-expand/expand-chevron'
import { getCustomSortingFns } from '../sorting-fns'
import { ColumnCell } from './components/column-cell'
import { ColumnHeader } from './components/column-header'
import { assignSortingFn } from './sorting'
import {
  isColumnFilterable,
  normalizeColumnName,
  parseColumnFormat,
} from './utils'

export const EXPAND_COLUMN_ID = '__expand'

/**
 * Synthetic (non-data) column ids injected by the table system itself:
 * `EXPAND_COLUMN_ID` (expand/collapse chevron), `select` (row-selection
 * checkbox), and `action` (row action menu). Client-side filter, search,
 * sort, card, and drag-reorder logic must exclude these — they carry no
 * query-config data. Single source of truth; do not re-list these ids inline.
 */
export const UTILITY_COLUMN_IDS: ReadonlySet<string> = new Set([
  EXPAND_COLUMN_ID,
  'select',
  'action',
])

/** Build the synthetic leftmost column that renders an expand/collapse chevron. */
export function buildExpandColumnDef<
  TData extends RowData,
  TValue extends React.ReactNode,
>(): ColumnDef<TData, TValue> {
  return {
    id: EXPAND_COLUMN_ID,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    size: 32,
    minSize: 32,
    maxSize: 32,
    header: () => <span className="sr-only">Expand row</span>,
    cell: ({ row }: { row: Row<TData> }) => <ExpandChevron row={row} />,
  } as ColumnDef<TData, TValue>
}

export type {
  ColumnFilterContext,
  ColumnFormatInfo,
  ColumnType,
  GetColumnDefsOptions,
} from './types'

export { normalizeColumnName } from './utils'

/**
 * Estimate content-aware column widths from a data sample.
 *
 * Returns a map of normalized column name → estimated pixel width, but only for
 * columns that have no explicit `columnSizing.size` (those keep their configured
 * width). Width is derived from the longer of the header label or sampled cell
 * values (chrome budget: ~64px header chrome + cell padding + 32px buffer).
 *
 * Extracted from {@link getColumnDefs} so the render path can memoize it on the
 * *unfiltered* dataset — column width should reflect the full data, not the
 * currently filtered view, and re-sampling on every search keystroke is wasteful.
 */
export function estimateColumnSizes<TData extends RowData>(
  config: GetColumnDefsOptions<TData>['config'],
  data: TData[]
): Record<string, number> {
  const SAMPLE_SIZE = 30
  const CHAR_WIDTH = 7.2 // Approximate width of a character in px
  const CHROME_BUDGET = 96 // Header chrome + cell padding
  const MIN_WIDTH = 80
  const MAX_WIDTH = 480

  const sizes: Record<string, number> = {}

  for (const column of config.columns || []) {
    const name = normalizeColumnName(column)
    const explicit =
      config.columnSizing?.[name] ?? config.columnSizing?.[column]
    // An explicit size wins; no estimate needed.
    if (explicit?.size !== undefined) continue

    let maxChars = name.length
    // Sample cell values for content width estimation
    const sampleSize = Math.min(data.length, SAMPLE_SIZE)
    if (sampleSize > 0) {
      const step =
        data.length > sampleSize ? Math.floor(data.length / sampleSize) : 1
      for (let i = 0; i < data.length; i += step) {
        const row = data[i] as Record<string, unknown>
        const value = row[column]
        if (value != null) {
          maxChars = Math.max(maxChars, String(value).length)
        }
      }
    }
    const estimatedSize = Math.round(maxChars * CHAR_WIDTH + CHROME_BUDGET)
    sizes[name] = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, estimatedSize))
  }

  return sizes
}

/**
 * Generates an array of column definitions based on the provided configuration.
 *
 * @param config - The configuration object for the query.
 * @param data - The data array for cell rendering context.
 * @param context - Additional context for cell formatting.
 * @param filterContext - Optional filter context for column filtering.
 *
 * @returns An array of column definitions.
 *
 * @example
 * ```tsx
 * const columns = getColumnDefs(config, data, {}, {
 *   enableColumnFilters: true,
 *   filterableColumns: ['name', 'status'],
 *   columnFilters: { name: 'foo' },
 *   setColumnFilter: (col, val) => {...},
 *   clearColumnFilter: (col) => {...},
 * })
 * ```
 */
export function getColumnDefs<
  TData extends RowData,
  TValue extends React.ReactNode,
>(
  config: GetColumnDefsOptions<TData>['config'],
  data: TData[],
  context: GetColumnDefsOptions<TData>['context'],
  filterContext?: ColumnFilterContext,
  schemaFilterContext?: SchemaColumnFilterContext,
  estimatedSizes?: Record<string, number>
): ColumnDef<TData, TValue>[] {
  const configColumns = config.columns || []
  const customSortingFns = getCustomSortingFns<TData>()

  // Content-aware widths are expensive to estimate (samples up to 30 rows per
  // column). Callers in the render path precompute them once from the
  // *unfiltered* dataset and pass them in; standalone callers fall back to
  // computing from whatever `data` they provide (identical to the old inline
  // behavior).
  const columnSizes = estimatedSizes ?? estimateColumnSizes(config, data)

  const {
    enableColumnFilters = false,
    filterableColumns = [],
    columnFilters = {},
    setColumnFilter,
  } = filterContext || {}

  return configColumns.map((column) => {
    const name = normalizeColumnName(column)
    const { format: columnFormat, options: columnFormatOptions } =
      parseColumnFormat(column, config.columnFormats || {})
    const sortingFnName = config.sortingFns?.[name]
    let sizing = config.columnSizing?.[name] ?? config.columnSizing?.[column]

    // Apply the content-aware width estimate when no explicit size is
    // configured (see estimateColumnSizes for the heuristic).
    if (!sizing || sizing.size === undefined) {
      const estimatedSize = columnSizes[name]
      if (estimatedSize !== undefined) {
        sizing = { ...(sizing || {}), size: estimatedSize }
      }
    }

    // Check if this column should have a filter
    const isFilterable = isColumnFilterable(
      name,
      enableColumnFilters,
      filterableColumns
    )

    // Schema-driven typed filter (date-range, multi-select, etc.)
    const columnFilterDef = config.columnFilters?.[
      column as keyof typeof config.columnFilters
    ] as
      | NonNullable<typeof config.columnFilters>[keyof NonNullable<
          typeof config.columnFilters
        >]
      | undefined
    const schemaField = schemaFilterContext
      ? resolveColumnFilterField(
          name,
          columnFilterDef,
          schemaFilterContext.schema
        )
      : null
    const schemaFilter =
      schemaField && columnFilterDef && schemaFilterContext
        ? {
            field: schemaField,
            def: columnFilterDef,
            configName: schemaFilterContext.configName,
            activeFilter: schemaFilterContext.getActiveFilter(schemaField),
            onSubmit: (
              draft: import('@/components/filters/filter-editor').FilterDraft
            ) => schemaFilterContext.setFilter(schemaField.key, draft),
            onClear: () => schemaFilterContext.clearFilter(schemaField.key),
          }
        : undefined

    // Create the column definition
    const columnDef: ColumnDef<TData, TValue> = {
      id: name,
      accessorKey: column,

      header: ({ column: col }) => (
        <ColumnHeader<TData>
          column={col as Column<TData, unknown>}
          name={name}
          format={columnFormat as ColumnFormat}
          icon={config.columnIcons?.[name]}
          description={
            config.columnDescriptions?.[name] ??
            config.columnDescriptions?.[column]
          }
          isFilterable={isFilterable}
          filterValue={columnFilters[name] || ''}
          onFilterChange={(value) => setColumnFilter?.(name, value)}
          schemaFilter={schemaFilter}
        />
      ),

      cell: ({
        table,
        row,
        getValue,
      }: {
        table: Table<TData>
        row: Row<TData>
        getValue: () => TValue
      }) => (
        <ColumnCell<TData, TValue>
          table={table}
          data={data}
          row={row}
          getValue={getValue}
          columnKey={column}
          context={context}
          format={columnFormat as ColumnFormat}
          formatOptions={columnFormatOptions as ColumnFormatOptions}
        />
      ),
    }

    // Single-trigger action columns (ColumnFormat.Action → "⋯" dropdown menu)
    // render one icon button, so cap them tight. We deliberately do NOT match
    // by column name nor by ColumnFormat.InlineAction — inline-action columns
    // render multiple buttons (kill / analyze / open-in-explorer on Running
    // Queries) and need their natural width plus resize.
    const isMenuActionColumn = columnFormat === 'action'
    if (isMenuActionColumn) {
      columnDef.size = 56
      columnDef.minSize = 48
      columnDef.maxSize = 80
      columnDef.enableResizing = false
      columnDef.enableSorting = false
      columnDef.enableHiding = false
    }

    if (sizing?.size !== undefined) {
      columnDef.size = sizing.size
    }
    if (sizing?.minSize !== undefined) {
      columnDef.minSize = sizing.minSize
    }
    if (sizing?.maxSize !== undefined) {
      columnDef.maxSize = sizing.maxSize
    }

    // Add the sorting function if specified
    assignSortingFn(columnDef, sortingFnName, customSortingFns)

    return columnDef
  })
}

import {
  FilterIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type { RowData, Table } from '@tanstack/react-table'

import type { TableDensity } from '@/components/data-table/hooks'
import type { ApiResponseMetadata } from '@/lib/api/types'
import type { QueryConfig } from '@/types/query-config'
import type { TableFilterCondition } from '../hooks/use-filtered-data'

import { memo, useMemo, useState } from 'react'
import { CardToolbar } from '@/components/cards/card-toolbar'
import { CsvExportButton } from '@/components/data-table/buttons/csv-export-button'
import { ResetColumnOrderButton } from '@/components/data-table/buttons/reset-column-order'
import { UTILITY_COLUMN_IDS } from '@/components/data-table/column-defs'
import { BulkActions } from '@/components/data-table/components/bulk-actions'
import {
  DisplayOptionsDropdown,
  ViewToggle,
} from '@/components/data-table/components/data-table-header-parts'
import { MobileSortMenu } from '@/components/data-table/components/mobile-table-cards'
import { DebouncedInput } from '@/components/inputs/debounced-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getSqlForDisplay } from '@/types/query-config'

export interface DataTableHeaderProps<TData extends RowData> {
  /** Table title displayed in header */
  title: string
  /** Table description or subtitle */
  description: string | React.ReactNode
  /** Query configuration defining columns, formats, sorting */
  queryConfig: QueryConfig
  /** Additional toolbar elements (left side) */
  toolbarExtras?: React.ReactNode
  /** Additional toolbar elements (right side) */
  topRightToolbarExtras?: React.ReactNode
  /** Show SQL button visibility */
  showSQL: boolean
  /** TanStack Table instance */
  table: Table<TData>
  /** Show loading indicator when refreshing data */
  isRefreshing: boolean
  /** The actual SQL that was executed (after version selection) */
  executedSql?: string
  /** Query execution metadata */
  metadata?: Partial<ApiResponseMetadata>
  /** Enable column reordering with drag-and-drop */
  enableColumnReordering?: boolean
  /** Callback to reset column order to default */
  onResetColumnOrder?: () => void
  /** Current row density mode */
  density?: TableDensity
  /** Callback to change row density mode */
  onDensityChange?: (density: TableDensity) => void

  /** Client-side global search state */
  globalSearch: string
  onGlobalSearchChange: (value: string) => void
  /** Client-side advanced filter conditions */
  advancedFilters: TableFilterCondition[]
  onAdvancedFiltersChange: (filters: TableFilterCondition[]) => void

  /** Schema-driven FilterBar rendered inline (server-side filters). When present, hides client-side search/filters. */
  filterBarSlot?: React.ReactNode

  /** View toggle: show table/cards switch */
  offerViewToggle?: boolean
  view?: 'table' | 'cards' | 'auto'
  onViewChange?: (view: 'table' | 'cards') => void
}

const OPERATOR_LABELS: Record<TableFilterCondition['operator'], string> = {
  contains: 'contains',
  equals: 'equals',
  startsWith: 'starts with',
  endsWith: 'ends with',
  notContains: 'does not contain',
}

export const DataTableHeader = memo(function DataTableHeader<
  TData extends RowData,
>({
  title,
  description,
  queryConfig,
  toolbarExtras,
  topRightToolbarExtras,
  showSQL,
  table,
  isRefreshing,
  executedSql,
  metadata,
  enableColumnReordering = false,
  onResetColumnOrder,
  density = 'comfortable',
  onDensityChange,
  globalSearch,
  onGlobalSearchChange,
  advancedFilters,
  onAdvancedFiltersChange,
  filterBarSlot,
  offerViewToggle = false,
  view = 'auto',
  onViewChange,
}: DataTableHeaderProps<TData>) {
  const displaySql = executedSql || getSqlForDisplay(queryConfig.sql)

  // Popover filter draft state
  const [filterDrafts, setFilterDrafts] = useState<TableFilterCondition[]>([])
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)

  // Stable unique IDs for filter drafts (avoids Math.random collisions)
  const createFilterId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  // A blank filter draft seeded with the first filterable column.
  const blankFilterDraft = (): TableFilterCondition => ({
    id: createFilterId(),
    columnId: filterableColumns[0]?.column.id || '',
    operator: 'contains',
    value: '',
  })

  // Memoize filterable columns with their labels to avoid recomputing on every render.
  // This stabilizes the SelectItem arrays and reduces popover open cost.
  const filterableColumns = useMemo(() => {
    const cols = table
      .getAllLeafColumns()
      .filter((col) => !UTILITY_COLUMN_IDS.has(col.id))
    // Pre-compute labels once
    return cols.map((col) => {
      const header = col.columnDef.header
      const label = typeof header === 'string' ? header : col.id
      return { column: col, label }
    })
  }, [table])

  // Resolve a human-readable label for a column (uses memoized label)
  const getColumnLabel = (colId: string) => {
    const found = filterableColumns.find((item) => item.column.id === colId)
    return found?.label || colId
  }

  // Memoize operator options to avoid recreating SelectItems on every render
  const operatorOptions = useMemo(
    () =>
      Object.entries(OPERATOR_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    []
  )

  // Open popover: sync draft state with committed state
  const handleOpenFilters = (open: boolean) => {
    setIsFiltersOpen(open)
    if (open) {
      setFilterDrafts(
        advancedFilters.length > 0 ? [...advancedFilters] : [blankFilterDraft()]
      )
    }
  }

  const addFilterDraft = () => {
    setFilterDrafts((prev) => [...prev, blankFilterDraft()])
  }

  const updateFilterDraft = (
    id: string,
    updates: Partial<Omit<TableFilterCondition, 'id'>>
  ) => {
    setFilterDrafts((prev) =>
      prev.map((draft) => (draft.id === id ? { ...draft, ...updates } : draft))
    )
  }

  const removeFilterDraft = (id: string) => {
    setFilterDrafts((prev) => {
      const filtered = prev.filter((draft) => draft.id !== id)
      return filtered.length > 0 ? filtered : [blankFilterDraft()]
    })
  }

  const applyFilters = () => {
    // Only apply valid filters with values
    const validFilters = filterDrafts.filter(
      (draft) => draft.value.trim() !== ''
    )
    onAdvancedFiltersChange(validFilters)
    setIsFiltersOpen(false)
  }

  const removeCommittedFilter = (id: string) => {
    onAdvancedFiltersChange(advancedFilters.filter((f) => f.id !== id))
  }

  const clearAllFilters = () => {
    onGlobalSearchChange('')
    onAdvancedFiltersChange([])
  }

  return (
    <div className="flex flex-col gap-2.5 pb-2.5">
      {/* Row 1: Title and Description */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex-none">
              {title}
            </h1>
            {isRefreshing && (
              <Loader2Icon
                className="text-muted-foreground size-4 animate-spin shrink-0"
                aria-label="Loading data"
              />
            )}
            {toolbarExtras && (
              <div className="flex items-center gap-1">{toolbarExtras}</div>
            )}
            {queryConfig.bulkActions && queryConfig.bulkActions.length > 0 && (
              <BulkActions
                table={table}
                bulkActions={queryConfig.bulkActions}
                bulkActionKey={queryConfig.bulkActionKey || 'query_id'}
              />
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground truncate mt-0.5">
            {description || queryConfig.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {topRightToolbarExtras}
          {showSQL && (
            <CardToolbar sql={displaySql} metadata={metadata} alwaysVisible />
          )}
        </div>
      </div>

      {/* Row 2: Unified toolbar — single row for all modes */}
      {filterBarSlot ? (
        /* Schema-driven mode: FilterBar slot (left) + action buttons (right) */
        <div className="flex flex-wrap items-center gap-2 bg-card/65 dark:bg-card/40 border border-border/60 p-2 rounded-xl shadow-xs">
          {filterBarSlot}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {/* Sort control for card view — moved from separate row into unified toolbar */}
            {offerViewToggle && (view === 'cards' || view === 'auto') && (
              <div className={view === 'auto' ? 'sm:hidden' : ''}>
                <MobileSortMenu table={table} />
              </div>
            )}
            {offerViewToggle && (
              <ViewToggle view={view} onViewChange={onViewChange} />
            )}
            <DisplayOptionsDropdown
              table={table}
              density={density}
              onDensityChange={onDensityChange}
              getColumnLabel={getColumnLabel}
            />
            <CsvExportButton table={table} filename={queryConfig.name} />
            {enableColumnReordering && onResetColumnOrder && (
              <ResetColumnOrderButton onReset={onResetColumnOrder} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-card/65 dark:bg-card/40 border border-border/60 p-2 rounded-xl shadow-xs">
          {/* Search TextBox on left */}
          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60"
              aria-hidden="true"
            />
            <DebouncedInput
              value={globalSearch}
              onValueChange={onGlobalSearchChange}
              placeholder="Search across all fields..."
              debounceMs={300}
              className="h-8 w-full pl-9 pr-8 text-sm bg-muted/20 border-border/50 focus:bg-background focus:border-primary/50 placeholder:text-muted-foreground/50 transition-all rounded-lg shadow-none"
            />
            {globalSearch && (
              <button
                type="button"
                onClick={() => onGlobalSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground p-0.5 rounded"
                aria-label="Clear search"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          {/* Buttons on Right */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Filters Button with Advanced Popover */}
            <Popover open={isFiltersOpen} onOpenChange={handleOpenFilters}>
              <PopoverTrigger
                render={
                  <Button
                    variant={
                      advancedFilters.length > 0 ? 'secondary' : 'outline'
                    }
                    size="sm"
                    disabled={filterableColumns.length === 0}
                    className="gap-1.5 px-3 border-border/50 rounded-lg text-xs"
                  />
                }
              >
                <FilterIcon className="size-3.5" />
                <span>Filters</span>
                {advancedFilters.length > 0 && (
                  <span className="flex items-center justify-center size-4 bg-primary text-[10px] font-bold text-primary-foreground rounded-full">
                    {advancedFilters.length}
                  </span>
                )}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[450px] p-4 rounded-xl shadow-lg border border-border/80"
              >
                <div className="flex items-center justify-between pb-2 border-b border-border/40">
                  <span className="text-sm font-semibold text-foreground">
                    Filters
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsFiltersOpen(false)}
                    className="text-muted-foreground hover:text-foreground rounded p-1"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>

                {/* List of active filters rules */}
                <div className="flex flex-col gap-3 py-4 max-h-[300px] overflow-y-auto">
                  {filterDrafts.map((draft) => (
                    <div key={draft.id} className="flex items-center gap-2">
                      {/* Column Select */}
                      <Select
                        value={draft.columnId}
                        onValueChange={(val) =>
                          updateFilterDraft(draft.id, {
                            columnId: val ?? undefined,
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Filter column"
                          className="h-8 flex-1 text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filterableColumns.map(({ column: col, label }) => (
                            <SelectItem
                              key={col.id}
                              value={col.id}
                              className="text-xs"
                            >
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Operator Select */}
                      <Select
                        value={draft.operator}
                        onValueChange={(val) =>
                          updateFilterDraft(draft.id, {
                            operator: val as TableFilterCondition['operator'],
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label="Filter operator"
                          className="h-8 w-[130px] text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operatorOptions.map(({ value: op, label }) => (
                            <SelectItem key={op} value={op} className="text-xs">
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Value Input */}
                      <Input
                        placeholder="value"
                        value={draft.value}
                        onChange={(e) =>
                          updateFilterDraft(draft.id, { value: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            applyFilters()
                          }
                        }}
                        className="h-8 flex-1 text-xs shadow-none"
                      />

                      {/* Trash Delete button */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeFilterDraft(draft.id)}
                        className="size-8 text-muted-foreground hover:text-destructive shrink-0"
                        aria-label="Remove filter condition"
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Add and Apply footer */}
                <div className="flex items-center justify-between pt-2.5 border-t border-border/40 text-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addFilterDraft}
                    className="h-8 gap-1 text-xs hover:bg-muted/50 rounded-lg text-primary font-medium"
                  >
                    <PlusIcon className="size-3.5" /> Add condition
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Press Enter to apply
                    </span>
                    <Button
                      size="sm"
                      onClick={applyFilters}
                      className="h-8 text-xs font-semibold rounded-lg"
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* View Toggle */}
            {offerViewToggle && (
              <ViewToggle view={view} onViewChange={onViewChange} />
            )}
            {/* Combined Display Options Dropdown */}
            <DisplayOptionsDropdown
              table={table}
              density={density}
              onDensityChange={onDensityChange}
              getColumnLabel={getColumnLabel}
            />

            {/* Export CSV button */}
            <CsvExportButton table={table} filename={queryConfig.name} />

            {/* Column Reordering Reset */}
            {enableColumnReordering && onResetColumnOrder && (
              <ResetColumnOrderButton onReset={onResetColumnOrder} />
            )}
          </div>
        </div>
      )}

      {/* Row 3: Records Count & Active Filter Chips (only for client-side filters) */}
      {!filterBarSlot && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs px-1 min-h-[24px]">
          {/* Count */}
          <span className="text-[12.5px] font-semibold text-muted-foreground">
            {table.getFilteredRowModel().rows.length} records
          </span>

          {/* Filter chips on the right */}
          {(advancedFilters.length > 0 || globalSearch) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {globalSearch && (
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium transition-colors">
                  <span>Search: &ldquo;{globalSearch}&rdquo;</span>
                  <button
                    type="button"
                    onClick={() => onGlobalSearchChange('')}
                    className="hover:text-foreground p-0.5 rounded"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              )}

              {advancedFilters.map((filter) => {
                const label = getColumnLabel(filter.columnId)
                return (
                  <div
                    key={filter.id}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/60 dark:bg-muted/40 border border-border/50 text-foreground/80 text-[11px] font-medium transition-colors"
                  >
                    <span>{`${label} ${OPERATOR_LABELS[filter.operator]} “${filter.value}”`}</span>
                    <button
                      type="button"
                      onClick={() => removeCommittedFilter(filter.id)}
                      aria-label={`Remove ${label} filter`}
                      className="text-muted-foreground/60 hover:text-foreground p-0.5 rounded"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                )
              })}

              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-6 gap-1 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-lg"
              >
                Clear all
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}) as <TData extends RowData>(
  props: DataTableHeaderProps<TData>
) => React.JSX.Element

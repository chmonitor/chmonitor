/**
 * Column Filter Component
 *
 * Provides debounced text input for filtering table columns
 * Can be added to table headers for client-side filtering
 *
 * @example
 * ```tsx
 * <ColumnFilter
 *   column="query"
 *   value={filterValue}
 *   onChange={setFilterValue}
 *   placeholder="Filter queries..."
 * />
 * ```
 */

import { Search, X } from 'lucide-react'

import { memo, useCallback, useMemo, useState } from 'react'
import { DebouncedInput } from '@/components/inputs/debounced-input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ColumnFilterProps {
  /** Column identifier */
  column: string
  /** Current filter value */
  value: string
  /** Callback when filter value changes */
  onChange: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Whether to show clear button */
  showClear?: boolean
  /** Additional class names */
  className?: string
}

export const ColumnFilter = memo(function ColumnFilter({
  column,
  value,
  onChange,
  placeholder = 'Filter...',
  showClear = true,
  className,
}: ColumnFilterProps) {
  const hasValue = value.length > 0

  const handleClear = useCallback(() => {
    onChange('')
  }, [onChange])

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 w-full max-w-[180px]',
        className
      )}
      role="search"
      aria-label={`Filter ${column} column`}
    >
      <div className="relative flex-1">
        <Search
          className="absolute left-1.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50"
          aria-hidden="true"
        />
        <DebouncedInput
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          debounceMs={300}
          className={cn(
            'h-7 w-full pl-6 text-xs shadow-none',
            'bg-muted/30 border-transparent',
            'focus:bg-background focus:border-primary/50',
            'placeholder:text-muted-foreground/60',
            'transition-colors'
          )}
          aria-label={`Filter ${column}`}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Escape' && hasValue) {
              e.preventDefault()
              onChange('')
            }
          }}
        />
      </div>
      {showClear && hasValue && (
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 hover:bg-muted/60"
          onClick={handleClear}
          aria-label={`Clear ${column} filter`}
        >
          <X className="size-3 text-muted-foreground" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
})

/**
 * Column Filter Provider Hook
 *
 * Manages filter state for table columns
 * Returns filtered data and filter controls
 *
 * @example
 * ```tsx
 * const { filteredData, filters, setFilter, clearFilter } = useColumnFilters(data, ['query', 'user'])
 * ```
 */

export interface ColumnFiltersState {
  filteredData: unknown[]
  filters: Record<string, string>
  setFilter: (column: string, value: string) => void
  clearFilter: (column: string) => void
  clearAllFilters: () => void
  hasFilters: boolean
}

export function useColumnFilters<T extends Record<string, unknown>>(
  data: T[],
  columns: string[] = []
): ColumnFiltersState {
  // Get all column keys from data if not provided
  const _filterColumns = useMemo(() => {
    if (columns.length > 0) return columns
    if (data.length === 0) return []
    return Object.keys(data[0] || {})
  }, [columns, data])

  const [filters, setFiltersState] = useState<Record<string, string>>({})

  const setFilter = useCallback((column: string, value: string) => {
    setFiltersState((prev) => ({
      ...prev,
      [column]: value,
    }))
  }, [])

  const clearFilter = useCallback((column: string) => {
    setFiltersState((prev) => {
      const { [column]: _, ...rest } = prev
      return rest
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setFiltersState({})
  }, [])

  // Filter data based on active filters
  const filteredData = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(
      ([_, value]) => value.length > 0
    )

    if (activeFilters.length === 0) {
      return data
    }

    return data.filter((row) => {
      return activeFilters.every(([column, filterValue]) => {
        const cellValue = String(row[column] ?? '').toLowerCase()
        const searchValue = filterValue.toLowerCase()
        return cellValue.includes(searchValue)
      })
    })
  }, [data, filters])

  const hasFilters = useMemo(
    () => Object.values(filters).some((value) => value.length > 0),
    [filters]
  )

  return {
    filteredData,
    filters,
    setFilter,
    clearFilter,
    clearAllFilters,
    hasFilters,
  }
}

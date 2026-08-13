import { useCallback, useMemo, useState } from 'react'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

export interface UseTableFiltersOptions {
  /** Enable URL synchronization for filters (default: false) */
  enableUrlSync?: boolean
  /** URL parameter prefix to avoid conflicts (default: 'filter') */
  urlPrefix?: string
}

/**
 * Hook for managing table column filters with optional URL sync
 *
 * @example
 * ```tsx
 * // Basic usage (in-memory filters)
 * const { columnFilters, setColumnFilter, clearAllColumnFilters } = useTableFilters()
 *
 * // With URL sync (filters are shareable via URL)
 * const { columnFilters, setColumnFilter, clearAllColumnFilters } = useTableFilters({
 *   enableUrlSync: true,
 *   urlPrefix: 'filter',
 * })
 * ```
 */
export function useTableFilters(options: UseTableFiltersOptions = {}) {
  const { enableUrlSync = false, urlPrefix = 'filter' } = options
  const searchParams = useUrlSearchParams()

  // Initialize filters from URL if sync is enabled
  const getInitialFilters = (): Record<string, string> => {
    if (!enableUrlSync) return {}

    const filters: Record<string, string> = {}
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith(`${urlPrefix}.`) && value) {
        // Remove prefix to get column name (e.g., "filter.database" -> "database")
        const columnName = key.slice(urlPrefix.length + 1)
        filters[columnName] = value
      }
    }
    return filters
  }

  const [columnFilters, setColumnFilters] =
    useState<Record<string, string>>(getInitialFilters)

  const setColumnFilter = useCallback(
    (column: string, value: string) => {
      setColumnFilters((prev) => {
        const next = { ...prev, [column]: value }

        // Update URL if sync is enabled
        if (enableUrlSync) {
          const url = new URL(window.location.href)
          const paramKey = `${urlPrefix}.${column}`

          if (value) {
            url.searchParams.set(paramKey, value)
          } else {
            url.searchParams.delete(paramKey)
          }

          window.history.replaceState({}, '', url.toString())
        }

        return next
      })
    },
    [enableUrlSync, urlPrefix]
  )

  const clearColumnFilter = useCallback(
    (column: string) => {
      setColumnFilters((prev) => {
        const { [column]: _, ...rest } = prev

        // Remove from URL if sync is enabled
        if (enableUrlSync) {
          const url = new URL(window.location.href)
          url.searchParams.delete(`${urlPrefix}.${column}`)
          window.history.replaceState({}, '', url.toString())
        }

        return rest
      })
    },
    [enableUrlSync, urlPrefix]
  )

  const clearAllColumnFilters = useCallback(() => {
    setColumnFilters({})

    // Clear all filter params from URL if sync is enabled
    if (enableUrlSync) {
      const url = new URL(window.location.href)
      for (const key of url.searchParams.keys()) {
        if (key.startsWith(`${urlPrefix}.`)) {
          url.searchParams.delete(key)
        }
      }
      window.history.replaceState({}, '', url.toString())
    }
  }, [enableUrlSync, urlPrefix])

  const activeFilterCount = useMemo(
    () => Object.values(columnFilters).filter((v) => v.length > 0).length,
    [columnFilters]
  )

  return {
    columnFilters,
    setColumnFilter,
    clearColumnFilter,
    clearAllColumnFilters,
    activeFilterCount,
  }
}

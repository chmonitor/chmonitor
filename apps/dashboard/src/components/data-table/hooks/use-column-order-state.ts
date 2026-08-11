import type { ColumnOrderState } from '@tanstack/react-table'

import { useCallback, useState } from 'react'

interface UseColumnOrderStateParams {
  /** Storage key override; falls back to the query config name. */
  columnOrderStorageKey?: string
  queryConfigName: string
  enabled: boolean
}

/**
 * Column-order state for `DataTable`'s drag-and-drop reordering, persisted to
 * localStorage per query config (or an explicit `columnOrderStorageKey`) when
 * reordering is enabled. Only the raw order array + its persistence lives
 * here — pinning the synthetic `__expand`/`select` utility column ids to the
 * front is the caller's job (`DataTable` computes `finalColumnOrder` from
 * this state, since it also needs `expandable`/`enableRowSelection`).
 */
export function useColumnOrderState({
  columnOrderStorageKey,
  queryConfigName,
  enabled,
}: UseColumnOrderStateParams) {
  const getStorageKey = useCallback(
    () => `data-table-column-order-${columnOrderStorageKey || queryConfigName}`,
    [columnOrderStorageKey, queryConfigName]
  )

  const initialColumnOrder = (() => {
    if (enabled && typeof window !== 'undefined') {
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

  // Persist column order to localStorage when it changes. Handles both direct
  // values and updater functions from TanStack Table.
  const handleColumnOrderChange = useCallback(
    (
      updaterOrValue:
        | ColumnOrderState
        | ((old: ColumnOrderState) => ColumnOrderState)
    ) => {
      setColumnOrder(updaterOrValue)

      if (enabled && typeof window !== 'undefined') {
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
    [columnOrder, enabled, getStorageKey]
  )

  const resetColumnOrder = useCallback(() => {
    handleColumnOrderChange([])
    if (enabled && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(getStorageKey())
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [handleColumnOrderChange, enabled, getStorageKey])

  return {
    columnOrder,
    handleColumnOrderChange,
    resetColumnOrder,
  }
}

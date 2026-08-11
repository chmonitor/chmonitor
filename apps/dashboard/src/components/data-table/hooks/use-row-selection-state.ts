import type { RowSelectionState, Updater } from '@tanstack/react-table'

import { useCallback, useState } from 'react'

/**
 * Row-selection state for `DataTable`'s checkbox column, forwarding every
 * change to the optional `onRowSelectionChange` prop so callers can read the
 * selected rows without owning the state themselves.
 */
export function useRowSelectionState(
  onRowSelectionChange?: (selectedRows: RowSelectionState) => void
) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const handleRowSelectionChange = useCallback(
    (updaterOrValue: Updater<RowSelectionState>) => {
      setRowSelection((current) => {
        const next =
          typeof updaterOrValue === 'function'
            ? updaterOrValue(current)
            : updaterOrValue
        onRowSelectionChange?.(next)
        return next
      })
    },
    [onRowSelectionChange]
  )

  return { rowSelection, handleRowSelectionChange }
}

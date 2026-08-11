import type { ColumnSizingState } from '@tanstack/react-table'

import { useState } from 'react'

/**
 * Column-resize state for `DataTable`. TanStack Table owns the actual drag
 * interaction (via `columnResizeMode`); this hook just holds the resulting
 * per-column widths so they survive re-renders and can be handed to
 * `useReactTable`'s `state.columnSizing` / `onColumnSizingChange`.
 */
export function useColumnSizing() {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  return { columnSizing, setColumnSizing }
}

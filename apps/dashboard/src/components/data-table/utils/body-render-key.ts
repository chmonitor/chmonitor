/**
 * Builds the memo-busting key for the table body from primitives, instead of
 * JSON.stringify-ing the whole state graph on every render (see the caller's
 * comment above `bodyRenderKey` in data-table.tsx for why the key exists).
 *
 * Pure utility, not a hook — it makes no React calls. The key MUST change iff
 * any of the 9 inputs changes: if a new controlled state is added to the
 * table (e.g. grouping), add it here too or the body will silently go stale
 * for that dimension.
 */

import type {
  ColumnOrderState,
  ColumnSizingState,
  ExpandedState,
  PaginationState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'

export function computeTableBodyRenderKey(input: {
  sorting: SortingState
  pagination: PaginationState
  expanded: ExpandedState
  columnSizing: ColumnSizingState
  columnOrder: ColumnOrderState
  columnVisibility: VisibilityState
  rowSelection: RowSelectionState
  globalSearch: string
  advancedFilters: unknown
}): string {
  const {
    sorting,
    pagination,
    expanded,
    columnSizing,
    columnOrder,
    columnVisibility,
    rowSelection,
    globalSearch,
    advancedFilters,
  } = input

  const sort = sorting.map((s) => `${s.id}:${s.desc ? 1 : 0}`).join(',')
  const page = `${pagination.pageIndex}:${pagination.pageSize}`
  const exp =
    expanded === true
      ? 'all'
      : Object.keys(expanded)
          .sort()
          .map(
            (k) => `${k}:${(expanded as Record<string, boolean>)[k] ? 1 : 0}`
          )
          .join(',')
  const sizing = Object.keys(columnSizing)
    .sort()
    .map((k) => `${k}:${columnSizing[k]}`)
    .join(',')
  const order = columnOrder.join(',')
  const vis = Object.keys(columnVisibility)
    .sort()
    .map((k) => `${k}:${columnVisibility[k] ? 1 : 0}`)
    .join(',')
  const sel = Object.keys(rowSelection)
    .sort()
    .map((k) => `${k}:${rowSelection[k] ? 1 : 0}`)
    .join(',')
  // advancedFilters is small app-defined config; JSON is fine and safe here.
  return [
    sort,
    page,
    exp,
    sizing,
    order,
    vis,
    sel,
    globalSearch,
    JSON.stringify(advancedFilters),
  ].join('|')
}

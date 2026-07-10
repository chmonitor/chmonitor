import type { Row, RowData, SortingFn } from '@tanstack/react-table'

import type { ValueOf } from '@chm/types/generic'

/**
 * Coerces a cell value to a numeric sort key. Nullish or non-numeric values
 * map to +Infinity so they consistently sort after valid numbers, instead of
 * silently comparing equal to everything (the bug this replaces).
 */
function toSortValue(value: unknown): number {
  if (value === null || value === undefined) return Number.POSITIVE_INFINITY
  const num = Number(value)
  return Number.isNaN(num) ? Number.POSITIVE_INFINITY : num
}

/**
 * Get sorting functions for the table.
 * Reference: https://tanstack.com/table/v8/docs/guide/sorting#custom-sorting-functions
 *
 * @param <TData> - The type of the data in the table.
 * @returns - The sorting functions for the table.
 */
export const getCustomSortingFns = <TData extends RowData>() => {
  return {
    sort_column_using_actual_value: (
      rowA: Row<TData>,
      rowB: Row<TData>,
      columnId: string
    ): number => {
      const colName = columnId.replace('readable_', '').replace('pct_', '')
      const valueA = rowA.original[colName as keyof TData]
      const valueB = rowB.original[colName as keyof TData]

      const numA = toSortValue(valueA)
      const numB = toSortValue(valueB)

      // Both nullish/non-numeric — equal rather than an arbitrary order
      // (also avoids Infinity - Infinity === NaN below).
      if (!Number.isFinite(numA) && !Number.isFinite(numB)) return 0

      return numA - numB
    },
  } as Record<string, SortingFn<TData>>
}

export type CustomSortingFnNames = keyof ReturnType<typeof getCustomSortingFns>
export type CustomSortingFn = ValueOf<ReturnType<typeof getCustomSortingFns>>

import type { BuiltInSortingFn, ColumnDef } from '@tanstack/react-table'

import type { CustomSortingFnNames, getCustomSortingFns } from '../sorting-fns'

const BUILTIN_SORTING_FNS = [
  'alphanumeric',
  'alphanumericCaseSensitive',
  'text',
  'textCaseSensitive',
  'datetime',
  'basic',
] as const

export function assignSortingFn<TData, TValue = unknown>(
  columnDef: ColumnDef<TData, TValue>,
  sortingFnName: string | undefined,
  customSortingFns: ReturnType<typeof getCustomSortingFns<TData>>
): void {
  if (!sortingFnName) return

  if (sortingFnName in customSortingFns) {
    columnDef.sortingFn =
      customSortingFns[sortingFnName as CustomSortingFnNames]
    return
  }

  if (BUILTIN_SORTING_FNS.includes(sortingFnName as BuiltInSortingFn)) {
    columnDef.sortingFn = sortingFnName as BuiltInSortingFn
  }
}

import type { Row, RowData, Table } from '@tanstack/react-table'

import type { ColumnFormat, ColumnFormatOptions } from '@/types/column-format'
import type { RowContextFormatter, ValueOnlyFormatter } from './types'

import { ADVANCED_FORMATTERS } from './advanced-formatters'
import { CONTEXT_FORMATTERS } from './context-formatters'
import { INLINE_FORMATTERS } from './inline-formatters'
import { VALUE_FORMATTERS } from './value-formatters'

export function getInlineFormatter(
  format: ColumnFormat
): ((value: unknown) => React.ReactNode) | undefined {
  return INLINE_FORMATTERS[format as keyof typeof INLINE_FORMATTERS]
}

export function getValueFormatter(
  format: ColumnFormat
):
  | ((value: unknown, options?: ColumnFormatOptions) => React.ReactNode)
  | undefined {
  return VALUE_FORMATTERS[format as keyof typeof VALUE_FORMATTERS]
}

export function getContextFormatter<TData extends RowData, TValue>(
  format: ColumnFormat
):
  | ((props: {
      table: Table<TData>
      data: TData[]
      row: Row<TData>
      value: TValue
      columnName: string
      context: Record<string, string>
      options?: ColumnFormatOptions
    }) => React.ReactNode)
  | undefined {
  return CONTEXT_FORMATTERS[
    format as keyof typeof CONTEXT_FORMATTERS
  ] as RowContextFormatter<TData, TValue>
}

export function getAdvancedFormatter<TData extends RowData, TValue>(
  format: ColumnFormat
):
  | ((value: unknown, options?: ColumnFormatOptions) => React.ReactNode)
  | ((props: {
      table: Table<TData>
      data: TData[]
      row: Row<TData>
      value: TValue
      columnName: string
      context: Record<string, string>
      options?: ColumnFormatOptions
    }) => React.ReactNode)
  | undefined {
  return ADVANCED_FORMATTERS[format as keyof typeof ADVANCED_FORMATTERS] as
    | ValueOnlyFormatter
    | RowContextFormatter<TData, TValue>
}

import type { Row, RowData, Table } from '@tanstack/react-table'

import type { ColumnFormat, ColumnFormatOptions } from '@/types/column-format'

export interface FormatterProps<TData extends RowData, TValue> {
  table: Table<TData>
  data: TData[]
  row: Row<TData>
  value: TValue
  columnName: string
  context: Record<string, string>
  options?: ColumnFormatOptions
}

export type InlineFormatter<TValue = unknown> = (
  value: TValue
) => React.ReactNode

export type ValueOnlyFormatter<TValue = unknown> = (
  value: TValue,
  options?: ColumnFormatOptions
) => React.ReactNode

export type RowContextFormatter<
  TData extends RowData = RowData,
  TValue = unknown,
> = (props: FormatterProps<TData, TValue>) => React.ReactNode

export type Formatter<TData extends RowData, TValue> =
  | InlineFormatter<TValue>
  | ValueOnlyFormatter<TValue>
  | RowContextFormatter<TData, TValue>

export interface FormatterEntry<TData extends RowData, TValue> {
  type: 'inline' | 'value' | 'context'
  format: ColumnFormat
  formatter: Formatter<TData, TValue>
}

export interface FormatterLookupResult<TData extends RowData, TValue> {
  formatter: Formatter<TData, TValue>
  type: 'inline' | 'value' | 'context'
}

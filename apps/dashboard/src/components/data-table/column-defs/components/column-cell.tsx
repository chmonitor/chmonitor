import type { Row, RowData, Table } from '@tanstack/react-table'

import type { ColumnFormat, ColumnFormatOptions } from '@/types/column-format'

import { memo } from 'react'
import { formatCell } from '@/components/data-table/formatters'

interface ColumnCellProps<
  TData extends RowData,
  TValue extends React.ReactNode,
> {
  table: Table<TData>
  data: TData[]
  row: Row<TData>
  getValue: () => TValue
  columnKey: string
  context: Record<string, string>
  format: ColumnFormat
  formatOptions?: ColumnFormatOptions
}

function ColumnCellInner<
  TData extends RowData,
  TValue extends React.ReactNode,
>({
  table,
  data,
  row,
  getValue,
  columnKey,
  context,
  format,
  formatOptions,
}: ColumnCellProps<TData, TValue>) {
  const value = getValue()

  return formatCell<TData, TValue>(
    table,
    data,
    row,
    value,
    columnKey,
    context,
    format,
    formatOptions
  )
}

export const ColumnCell = memo(ColumnCellInner) as typeof ColumnCellInner

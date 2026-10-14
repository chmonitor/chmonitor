import type { Row, RowData, Table } from '@tanstack/react-table'

import type { RowContextFormatter, ValueOnlyFormatter } from './types'

import {
  getAdvancedFormatter,
  getContextFormatter,
  getInlineFormatter,
  getValueFormatter,
} from './formatter-lookup'
import {
  hasAdvancedFormatter,
  hasContextFormatter,
  hasInlineFormatter,
  hasValueFormatter,
} from './formatter-selector'
import { ExpandableCell } from '@/components/data-table/components/expandable-cell'
import { ColumnFormat, type ColumnFormatOptions } from '@/types/column-format'

export function formatCell<
  TData extends RowData,
  TValue extends React.ReactNode,
>(
  table: Table<TData>,
  data: TData[],
  row: Row<TData>,
  value: TValue,
  columnName: string,
  context: Record<string, string>,
  format: ColumnFormat,
  columnFormatOptions?: ColumnFormatOptions
): React.ReactNode {
  if (hasInlineFormatter(format)) {
    const formatter = getInlineFormatter(format)
    if (formatter) {
      return formatter(value)
    }
  }

  if (hasValueFormatter(format)) {
    const formatter = getValueFormatter(format)
    if (formatter) {
      return formatter(value, columnFormatOptions)
    }
  }

  if (hasAdvancedFormatter(format)) {
    const formatter = getAdvancedFormatter<TData, TValue>(format)
    if (formatter) {
      if (format === ColumnFormat.CodeToggle) {
        return (formatter as RowContextFormatter<TData, TValue>)({
          table,
          data,
          row,
          value,
          columnName,
          context,
          options: columnFormatOptions,
        })
      }
      return (formatter as ValueOnlyFormatter)(value, columnFormatOptions)
    }
  }

  if (hasContextFormatter(format)) {
    const formatter = getContextFormatter<TData, TValue>(format)
    if (formatter) {
      return formatter({
        table,
        data,
        row,
        value,
        columnName,
        context,
        options: columnFormatOptions,
      })
    }
  }

  const strValue = String(value ?? '')
  return <ExpandableCell value={strValue} />
}

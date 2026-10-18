import { ColumnFormat } from '@/types/column-format'

export function normalizeColumnName(column: string): string {
  return column.toLocaleLowerCase().replace('readable_', '').trim()
}

export function parseColumnFormat(
  column: string,
  config: Record<string, unknown>
): { format: ColumnFormat; options?: Record<string, unknown> } {
  const format =
    config[column] || config[normalizeColumnName(column)] || ColumnFormat.None

  if (Array.isArray(format) && format.length === 2) {
    return {
      format: format[0] as ColumnFormat,
      options: format[1] as Record<string, unknown>,
    }
  }

  return { format: format as ColumnFormat }
}

export function isColumnFilterable(
  columnName: string,
  enableColumnFilters: boolean,
  filterableColumns: string[]
): boolean {
  return (
    enableColumnFilters &&
    (filterableColumns.length === 0 || filterableColumns.includes(columnName))
  )
}

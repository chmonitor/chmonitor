import type { Row, RowData, Table } from '@tanstack/react-table'

import { getBarStyle, getColorFromBank, getShade } from '@/lib/color-bank'
import { formatReadableQuantity } from '@/lib/format-readable'

export interface BackgroundBarOptions {
  numberFormat?: boolean
}

interface BackgroundBarFormatProps<TData extends RowData = RowData> {
  table: Table<TData>
  row: Row<TData>
  columnName: string
  value: React.ReactNode
  options?: BackgroundBarOptions
}

export const BackgroundBarFormat = function BackgroundBarFormat<
  TData extends RowData = RowData,
>({
  table,
  row,
  columnName,
  value,
  options,
}: BackgroundBarFormatProps<TData>): React.ReactNode {
  // Disable if row count <= 1
  if (table.getCoreRowModel()?.rows?.length <= 1) return value

  // Looking at pct_{columnName} for the value
  const colName = columnName.replace('readable_', '')
  const pctColName = `pct_${colName}`
  // row.original is generic (TData); read dynamic keys via a narrow record cast.
  const original = row.original as Record<string, unknown>
  const pct = original[pctColName]
  const orgValue = original[colName]

  if (pct === undefined || pct === null || !Number.isFinite(Number(pct))) {
    // Column pct_{columnName} is not defined in the query
    return value
  }

  // Get color from bank based on column name (deterministic)
  const baseColor = getColorFromBank(columnName)

  // Calculate shade based on percentage (larger = darker)
  const shade = getShade(pct as number)

  // Build inline style with dynamic color (lower opacity for a subtle background bar)
  const barStyle = getBarStyle(baseColor, shade, 0.35)

  return (
    <div
      className="relative flex items-center w-full h-full overflow-hidden"
      title={`${orgValue} (${pct}%)`}
      role="progressbar"
      aria-label={`${orgValue} (${pct}%)`}
      aria-valuenow={Number(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Background bar — a solid-color div. Animate fill with a GPU-composited
          transform (scaleX) instead of width, so the per-refresh transition
          doesn't trigger layout. */}
      <div
        className="absolute inset-y-0 left-0 origin-left transition-transform"
        style={{
          width: '100%',
          transform: `scaleX(${Number(pct) / 100})`,
          ...barStyle,
        }}
        aria-hidden="true"
      />
      <span className="relative inline-block min-w-0 truncate px-1.5 tabular-nums">
        {options?.numberFormat
          ? formatReadableQuantity(value as number, 'long')
          : value}
      </span>
    </div>
  )
}

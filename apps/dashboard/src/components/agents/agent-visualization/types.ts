export interface VizConfig {
  chartType:
    | 'bar'
    | 'line'
    | 'area'
    | 'pie'
    | 'number'
    | 'table'
    | 'combo'
    | 'radial'
    | 'bar_list'
    | 'scatter'
  xKey: string
  yKeys: string[]
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  readable?: 'bytes' | 'duration' | 'number' | 'quantity'
}

export interface AgentVisualizationProps {
  title?: string
  /** Underlying SQL. Optional — legacy chart payloads carry no query, in which
   *  case the Query tab is hidden. */
  sql?: string
  rows: Record<string, unknown>[]
  columns: string[]
  rowCount: number
  viz: VizConfig
  className?: string
}

export type ChartType = VizConfig['chartType']

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  combo: 'Combo',
  pie: 'Pie',
  number: 'Number',
  table: 'Table',
  radial: 'Radial',
  bar_list: 'Bar List',
  scatter: 'Scatter',
}

export function isNumericColumn(
  rows: Record<string, unknown>[],
  col: string
): boolean {
  if (rows.length === 0) return false
  const sample = rows.find((r) => r[col] !== null && r[col] !== undefined)
  if (!sample) return false
  const value = sample[col]
  if (typeof value === 'number') return true
  if (typeof value !== 'string' || value.trim() === '') return false
  return !Number.isNaN(Number(value))
}

export function sortRows(
  rows: Record<string, unknown>[],
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' | undefined
): Record<string, unknown>[] {
  if (!sortBy) return rows
  const order = sortOrder === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const av = a[sortBy]
    const bv = b[sortBy]
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * order
    }
    return String(av).localeCompare(String(bv)) * order
  })
}

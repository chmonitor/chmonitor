export const CHARTS_PER_ROW = 2

/**
 * Groups an array of charts into rows of CHARTS_PER_ROW items each.
 *
 * @example
 * groupChartsIntoRows([1,2,3,4,5,6]) // [[1,2,3,4], [5,6]]
 */
export function groupChartsIntoRows<T>(charts: T[]): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < charts.length; i += CHARTS_PER_ROW) {
    rows.push(charts.slice(i, i + CHARTS_PER_ROW))
  }
  return rows
}

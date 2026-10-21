import { createContext, useContext } from 'react'

/**
 * Whether the chart cells below are in (or near) the viewport. `useChartData`
 * and `useTableData` read it as the default for `pollingActive`, so a boundary
 * above the cell can pause polling for hooks that run above the `ChartCard`
 * element. Defaults to `true`: with no provider nothing changes.
 */
export const ChartViewportContext = createContext(true)

export function useChartViewportActive(): boolean {
  return useContext(ChartViewportContext)
}

import type { LazyChartComponent } from './types'

import { chartImports } from './chart-imports'

export function getChartComponent(
  chartName: string
): LazyChartComponent | undefined {
  return chartImports[chartName]
}

export function hasChart(chartName: string): boolean {
  return chartName in chartImports
}

export function getRegisteredChartNames(): string[] {
  return Object.keys(chartImports)
}

export function getChartsByCategory(category: string): string[] {
  return getRegisteredChartNames().filter((name) =>
    name.startsWith(category.toLowerCase())
  )
}

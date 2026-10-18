import type { LazyExoticComponent } from 'react'
import type { ChartProps } from '@/components/charts/chart-props'

export type { ChartProps }

export type ChartComponent = React.ComponentType<ChartProps>

export type ChartSkeletonType = 'area' | 'bar' | 'line' | 'metric' | 'table'

export type LazyChartComponent = LazyExoticComponent<ChartComponent>

export type ChartRegistryMap = Record<string, LazyChartComponent>

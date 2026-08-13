/**
 * Memory & CPU tab charts - deep-dive RSS decomposition, load average vs
 * cores, CPU mode split, thread pool utilization, plus links through to the
 * individual-query BackgroundBar tables ranked by peak memory / CPU time.
 */

import type { OverviewChartConfig } from './types'

import {
  ChartCpuLoadAverage,
  ChartCpuModeSplit,
  ChartMemoryBreakdown,
  ChartThreadPoolUtilization,
} from '../-charts-lazy'

export const MEMORY_CPU_TAB_CHARTS: OverviewChartConfig[] = [
  {
    id: 'memory-breakdown',
    component: ChartMemoryBreakdown,
    title: 'Memory Breakdown',
    className: 'w-full h-full',
    interval: 'toStartOfTenMinutes',
    lastHours: 24,
    type: 'area',
    href: '/top-memory-queries',
  },
  {
    id: 'cpu-load-average',
    component: ChartCpuLoadAverage,
    title: 'Load Average vs CPU Cores',
    className: 'w-full h-full',
    interval: 'toStartOfTenMinutes',
    lastHours: 24,
    type: 'area',
    href: '/metrics',
  },
  {
    id: 'cpu-mode-split',
    component: ChartCpuModeSplit,
    title: 'CPU Mode Split',
    className: 'w-full h-full',
    interval: 'toStartOfTenMinutes',
    lastHours: 24,
    type: 'area',
    href: '/top-cpu-queries',
  },
  {
    id: 'thread-pool-utilization',
    component: ChartThreadPoolUtilization,
    title: 'Thread Pool Utilization',
    className: 'w-full h-full',
    interval: 'toStartOfTenMinutes',
    lastHours: 24,
    type: 'area',
    href: '/metrics',
  },
]

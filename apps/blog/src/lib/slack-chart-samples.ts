/**
 * Hand-written data_visualization blocks that follow Slack's documented
 * limits, for the tests. Not the demo scenes: those come from the builders.
 */

import type { ChartPoint, DataVisualizationBlock } from './slack-chart-block'

const points = (categories: string[], values: number[]): ChartPoint[] =>
  categories.map((label, i) => ({ label, value: values[i] }))

/** Every five minutes from 08:12 to 09:47 UTC. */
const TIMES = Array.from({ length: 20 }, (_, i) => {
  const minutes = 8 * 60 + 12 + 5 * i
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
})
const DISK = [
  71, 72, 72, 73, 73, 74, 75, 75, 76, 77, 78, 79, 84, 85, 86, 88, 90, 92, 94,
  96,
]
const flat = (value: number): ChartPoint[] =>
  TIMES.map((label) => ({ label, value }))

/** A full 20-point window with the thresholds as flat series. */
export const LINE_WITH_THRESHOLDS: DataVisualizationBlock = {
  type: 'data_visualization',
  title: 'Disk used on prod-ch-1',
  chart: {
    type: 'line',
    series: [
      { name: 'Disk used', data: points(TIMES, DISK) },
      { name: 'warn', data: flat(80) },
      { name: 'crit', data: flat(95) },
    ],
    axis_config: {
      categories: TIMES,
      x_label: 'Time (UTC)',
      y_label: 'Disk used (%)',
    },
  },
}

/** Two series, with yesterday's points listed out of category order. */
export const GROUPED_BAR: DataVisualizationBlock = {
  type: 'data_visualization',
  title: 'Failed queries by host',
  chart: {
    type: 'bar',
    series: [
      {
        name: 'today',
        data: [
          { label: 'prod-ch-1', value: 42 },
          { label: 'prod-ch-2', value: 7 },
          { label: 'prod-ch-3', value: 19 },
        ],
      },
      {
        name: 'yesterday',
        data: [
          { label: 'prod-ch-3', value: 12 },
          { label: 'prod-ch-1', value: 30 },
          { label: 'prod-ch-2', value: 9 },
        ],
      },
    ],
    axis_config: {
      categories: ['prod-ch-1', 'prod-ch-2', 'prod-ch-3'],
      y_label: 'Failed queries',
    },
  },
}

export const PIE: DataVisualizationBlock = {
  type: 'data_visualization',
  title: 'Open alerts by rule',
  chart: {
    type: 'pie',
    segments: [
      { label: 'disk-usage', value: 3 },
      { label: 'replication-lag', value: 2 },
      { label: 'merges', value: 1 },
    ],
  },
}

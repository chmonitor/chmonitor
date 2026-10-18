import type { DeclarativeQueryConfig } from '../../schema'

export const histogramMetricsDeclarative: DeclarativeQueryConfig = {
  name: 'histogram-metrics',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['metric'] },
  description:
    'Instant histogram snapshots for latency and throughput metrics (system.histogram_metrics, CH 25.1+). Shows Keeper request stages, query durations, and other distribution metrics.',
  refreshInterval: 15_000,
  optional: true,
  tableCheck: 'system.histogram_metrics',
  sql: [
    {
      since: '25.1',
      description: 'Histogram buckets (one row per metric and label set)',
      sql: `
        SELECT
          metric,
          toString(labels) AS labels,
          value,
          formatReadableQuantity(value) AS readable_value,
          round(value * 100.0 / nullIf(max(value) OVER (), 0), 2) AS pct_value,
          description
        FROM system.histogram_metrics
        ORDER BY metric ASC, value DESC
      `,
    },
  ],
  columns: ['metric', 'labels', 'readable_value', 'description'],
  columnFormats: {
    metric: 'colored-badge',
    readable_value: 'background-bar',
  },
}

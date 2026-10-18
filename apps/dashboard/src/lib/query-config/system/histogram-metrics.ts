import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * system.histogram_metrics — available since ClickHouse 25.1.
 * Instant histogram snapshots of key latency/throughput metrics
 * (Keeper request stages, query durations, etc.).
 * Replaces the deprecated system.latency_log.
 */
export const histogramMetricsConfig: QueryConfig = {
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
    metric: ColumnFormat.ColoredBadge,
    readable_value: ColumnFormat.BackgroundBar,
  },
}

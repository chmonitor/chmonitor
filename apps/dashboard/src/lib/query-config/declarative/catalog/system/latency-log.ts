import type { DeclarativeQueryConfig } from '../../schema'

export const latencyLogDeclarative: DeclarativeQueryConfig = {
  name: 'latency-log',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['operation_name'] },
  description:
    'Per-operation latency observations (system.latency_log, CH 22.x–24.x). Deprecated in CH 25.1+ in favor of system.histogram_metrics.',
  refreshInterval: 30_000,
  optional: true,
  tableCheck: 'system.latency_log',
  sql: [
    {
      since: '22.1',
      description: 'Aggregate latency by operation from latency_log',
      sql: `
        SELECT
          operation_name,
          count() AS events,
          formatReadableQuantity(count()) AS readable_events,
          round(count() * 100.0 / nullIf(max(count()) OVER (), 0), 2) AS pct_events,
          round(avg(elapsed_microseconds), 2) AS avg_us,
          round(avg_us * 100.0 / nullIf(max(avg_us) OVER (), 0), 2) AS pct_avg_us,
          quantile(0.50)(elapsed_microseconds) AS p50_us,
          quantile(0.95)(elapsed_microseconds) AS p95_us,
          quantile(0.99)(elapsed_microseconds) AS p99_us,
          max(elapsed_microseconds) AS max_us
        FROM system.latency_log
        WHERE event_time >= now() - INTERVAL 1 HOUR
        GROUP BY operation_name
        ORDER BY avg_us DESC
        LIMIT 200
      `,
    },
  ],
  columns: [
    'operation_name',
    'readable_events',
    'avg_us',
    'p50_us',
    'p95_us',
    'p99_us',
    'max_us',
  ],
  columnFormats: {
    operation_name: 'colored-badge',
    readable_events: 'background-bar',
    avg_us: 'background-bar',
  },
}

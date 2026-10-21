import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * system.scheduler — available since ClickHouse 25.4.
 */
export const schedulerConfig: QueryConfig = {
  name: 'scheduler',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['resource', 'type'] },
  description:
    'Live resource scheduler node state: in-flight, queued, and budget per workload path (system.scheduler, CH 25.4+).',
  refreshInterval: 5_000,
  optional: true,
  tableCheck: 'system.scheduler',
  sql: [
    {
      since: '25.4',
      description: 'Live scheduler node state per resource and workload path',
      sql: `
        SELECT
          resource,
          path,
          type,
          dequeued_requests,
          formatReadableQuantity(dequeued_requests) AS readable_dequeued,
          round(dequeued_requests * 100.0 / nullIf(max(dequeued_requests) OVER (), 0), 2) AS pct_dequeued,
          dequeued_cost,
          inflight_requests,
          inflight_cost,
          budget,
          is_active
        FROM system.scheduler
        ORDER BY resource ASC, path ASC
      `,
    },
  ],
  columns: [
    'resource',
    'path',
    'type',
    'readable_dequeued',
    'dequeued_cost',
    'inflight_requests',
    'inflight_cost',
    'budget',
    'is_active',
  ],
  columnFormats: {
    resource: ColumnFormat.ColoredBadge,
    type: ColumnFormat.ColoredBadge,
    readable_dequeued: ColumnFormat.BackgroundBar,
    is_active: ColumnFormat.Boolean,
    inflight_requests: ColumnFormat.Number,
    inflight_cost: ColumnFormat.Number,
    budget: ColumnFormat.Number,
  },
}

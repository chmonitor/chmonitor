import type { DeclarativeQueryConfig } from '../../schema'

export const schedulerDeclarative: DeclarativeQueryConfig = {
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
    resource: 'colored-badge',
    type: 'colored-badge',
    readable_dequeued: 'background-bar',
    is_active: 'boolean',
    inflight_requests: 'number',
    inflight_cost: 'number',
    budget: 'number',
  },
}

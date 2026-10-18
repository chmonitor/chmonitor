import type { DeclarativeQueryConfig } from '../../schema'

export const viewRefreshesDeclarative: DeclarativeQueryConfig = {
  name: 'view-refreshes',
  defaultView: 'auto',
  card: { primary: 'view', badges: ['status'] },
  description: `Contains information about refresh operations for materialized views using the REFRESH keyword. https://clickhouse.com/docs/operations/system-tables/view_refreshes`,
  suggestion: `Create a materialized view with REFRESH:

CREATE MATERIALIZED VIEW my_view
REFRESH EVERY 1 HOUR
AS SELECT col1, col2 FROM my_table;

The view will refresh automatically on schedule.
Monitor status, failures, and performance here.

Requires: ClickHouse 24.3+
Only for views with explicit REFRESH intervals.

Learn more:
https://clickhouse.com/docs/en/sql-reference/statements/create/view#materialized-view`,
  optional: true,
  tableCheck: 'system.view_refreshes',
  sql: `
    SELECT *
    FROM system.view_refreshes
    ORDER BY next_refresh_time DESC
  `,
  columns: [
    'database',
    'view',
    'last_success_time',
    'last_refresh_time',
    'next_refresh_time',
    'progress',
    'status',
    'retry',
    'last_success_duration_ms',
    'total_rows',
    'read_rows',
    'written_rows',
    'exception',
  ],
  columnFormats: {
    last_refresh_time: 'related-time',
    next_refresh_time: 'related-time',
    database: 'text',
    view: [
      'link',
      { href: '/table?host=[ctx.hostId]&database=[database]&view=[view]' },
    ],
    status: 'colored-badge',
    total_rows: 'number',
    read_rows: 'number',
    written_rows: 'number',
    exception: 'text',
  },
  relatedCharts: [],
}

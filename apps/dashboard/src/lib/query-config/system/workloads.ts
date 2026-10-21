import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * system.workloads — available since ClickHouse 25.4.
 */
export const workloadsConfig: QueryConfig = {
  name: 'workloads',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['name', 'parent'] },
  description:
    'SQL resource scheduling workload hierarchy: name, parent, and CREATE WORKLOAD definition (system.workloads, CH 25.4+).',
  refreshInterval: 30_000,
  optional: true,
  tableCheck: 'system.workloads',
  sql: [
    {
      since: '25.4',
      description: 'Workload hierarchy with definitions',
      sql: `
        SELECT
          name,
          parent,
          create_query
        FROM system.workloads
        ORDER BY parent ASC, name ASC
      `,
    },
  ],
  columns: ['name', 'parent', 'create_query'],
  columnFormats: {
    name: ColumnFormat.ColoredBadge,
    parent: ColumnFormat.ColoredBadge,
  },
}

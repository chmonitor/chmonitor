import type { DeclarativeQueryConfig } from '../../schema'

export const workloadsDeclarative: DeclarativeQueryConfig = {
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
    name: 'colored-badge',
    parent: 'colored-badge',
  },
}

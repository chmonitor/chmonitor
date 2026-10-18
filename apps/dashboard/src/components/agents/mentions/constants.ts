import type { AutocompleteItem, SlashCommand } from './types'

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'analyze',
    label: '/analyze',
    description: 'Analyze query performance',
    promptTemplate: 'Analyze this ClickHouse query for performance issues:\n\n',
  },
  {
    name: 'explain',
    label: '/explain',
    description: 'Explain query execution plan',
    promptTemplate: 'Explain the execution plan for this query:\n\n',
  },
  {
    name: 'optimize',
    label: '/optimize',
    description: 'Suggest optimizations',
    promptTemplate: 'Suggest optimizations for this ClickHouse query:\n\n',
  },
  {
    name: 'compare',
    label: '/compare',
    description: 'Compare time periods',
    promptTemplate: 'Compare the following metrics across time periods:\n\n',
  },
  {
    name: 'schema',
    label: '/schema',
    description: 'Explore table schema',
    promptTemplate: 'Show the schema and details for:\n\n',
  },
  {
    name: 'health',
    label: '/health',
    description: 'System health check',
    promptTemplate:
      'Run a health check on the ClickHouse cluster and report:\n\n',
  },
]

export const SYSTEM_RESOURCES: AutocompleteItem[] = [
  {
    id: 'res-query_log',
    type: 'resource',
    label: 'system.query_log',
    description: 'Query execution log',
    value: 'system.query_log',
    group: 'System Resources',
  },
  {
    id: 'res-processes',
    type: 'resource',
    label: 'system.processes',
    description: 'Running queries',
    value: 'system.processes',
    group: 'System Resources',
  },
  {
    id: 'res-parts',
    type: 'resource',
    label: 'system.parts',
    description: 'Data parts info',
    value: 'system.parts',
    group: 'System Resources',
  },
  {
    id: 'res-merges',
    type: 'resource',
    label: 'system.merges',
    description: 'Active merge operations',
    value: 'system.merges',
    group: 'System Resources',
  },
  {
    id: 'res-replicas',
    type: 'resource',
    label: 'system.replicas',
    description: 'Replication status',
    value: 'system.replicas',
    group: 'System Resources',
  },
  {
    id: 'res-mutations',
    type: 'resource',
    label: 'system.mutations',
    description: 'ALTER mutations',
    value: 'system.mutations',
    group: 'System Resources',
  },
  {
    id: 'res-disks',
    type: 'resource',
    label: 'system.disks',
    description: 'Disk usage',
    value: 'system.disks',
    group: 'System Resources',
  },
  {
    id: 'res-clusters',
    type: 'resource',
    label: 'system.clusters',
    description: 'Cluster topology',
    value: 'system.clusters',
    group: 'System Resources',
  },
  {
    id: 'res-columns',
    type: 'resource',
    label: 'system.columns',
    description: 'Column metadata',
    value: 'system.columns',
    group: 'System Resources',
  },
  {
    id: 'res-tables',
    type: 'resource',
    label: 'system.tables',
    description: 'Table metadata',
    value: 'system.tables',
    group: 'System Resources',
  },
]

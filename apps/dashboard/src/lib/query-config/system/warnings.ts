import type { QueryConfig } from '@/types/query-config'

export const warningsConfig: QueryConfig = {
  name: 'warnings',
  defaultView: 'auto',
  card: { primary: 'message' },
  description:
    'Server-side warnings about potential configuration or operational issues',
  optional: true,
  tableCheck: 'system.warnings',
  refreshInterval: 30_000,
  sql: `SELECT message FROM system.warnings`,
  columns: ['message'],
}

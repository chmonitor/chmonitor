import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const sessionsConfig: QueryConfig = {
  name: 'sessions',
  permission: { feature: 'security' },
  description: 'Active and historical user sessions',
  optional: true,
  tableCheck: 'system.session_log',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/session_log',
  sql: `
    SELECT
      session_id,
      user,
      auth_type,
      client_hostname,
      client_address,
      event_time,
      type,
      interface,
      profiles,
      roles
    FROM system.session_log
    ORDER BY event_time DESC
    LIMIT 1000
  `,
  columns: [
    'session_id',
    'user',
    'auth_type',
    'client_hostname',
    'client_address',
    'event_time',
    'type',
    'interface',
    'profiles',
    'roles',
  ],
  columnFormats: {
    event_time: ColumnFormat.RelatedTime,
    user: ColumnFormat.ColoredBadge,
    type: ColumnFormat.ColoredBadge,
    auth_type: ColumnFormat.ColoredBadge,
    client_address: ColumnFormat.Text,
    interface: ColumnFormat.ColoredBadge,
  },
  relatedCharts: ['login-success-rate', 'active-sessions-count'],
}

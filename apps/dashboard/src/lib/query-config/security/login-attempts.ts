import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const loginAttemptsConfig: QueryConfig = {
  name: 'login-attempts',
  permission: { feature: 'security' },
  description: 'Login success and failure tracking',
  optional: true,
  tableCheck: 'system.session_log',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/session_log',
  sql: `
    SELECT
      event_time,
      user,
      auth_type,
      client_hostname,
      client_address,
      type,
      interface,
      failure_reason
    FROM system.session_log
    WHERE type IN ('LoginSuccess', 'LoginFailure')
    ORDER BY event_time DESC
    LIMIT 1000
  `,
  columns: [
    'event_time',
    'user',
    'type',
    'auth_type',
    'client_address',
    'failure_reason',
    'interface',
  ],
  columnFormats: {
    event_time: ColumnFormat.RelatedTime,
    user: ColumnFormat.ColoredBadge,
    type: ColumnFormat.ColoredBadge,
    auth_type: ColumnFormat.ColoredBadge,
    failure_reason: ColumnFormat.Text,
    interface: ColumnFormat.ColoredBadge,
  },
  filterParamPresets: [
    { name: 'Failed Only', key: 'type', value: 'LoginFailure' },
    { name: 'Success Only', key: 'type', value: 'LoginSuccess' },
  ],
  relatedCharts: ['login-success-rate', 'failed-login-by-user'],
}

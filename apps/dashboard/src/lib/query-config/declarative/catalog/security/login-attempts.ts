import type { DeclarativeQueryConfig } from '../../schema'

export const loginAttemptsDeclarative: DeclarativeQueryConfig = {
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
    event_time: 'related-time',
    user: 'colored-badge',
    type: 'colored-badge',
    auth_type: 'colored-badge',
    failure_reason: 'text',
    interface: 'colored-badge',
  },
  filterParamPresets: [
    { name: 'Failed Only', key: 'type', value: 'LoginFailure' },
    { name: 'Success Only', key: 'type', value: 'LoginSuccess' },
  ],
  relatedCharts: ['login-success-rate', 'failed-login-by-user'],
}

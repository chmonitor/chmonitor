import type { DeclarativeQueryConfig } from '../../schema'

export const sessionsDeclarative: DeclarativeQueryConfig = {
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
    event_time: 'related-time',
    user: 'colored-badge',
    type: 'colored-badge',
    auth_type: 'colored-badge',
    client_address: 'text',
    interface: 'colored-badge',
  },
  relatedCharts: ['login-success-rate', 'active-sessions-count'],
}

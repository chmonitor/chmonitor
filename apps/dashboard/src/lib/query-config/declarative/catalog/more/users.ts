import type { DeclarativeQueryConfig } from '../../schema'

const USERS_COLUMNS = [
  'name',
  'storage',
  'auth_type',
  'auth_params',
  'host_ip',
  'host_names',
  'default_roles_all',
  'default_roles_list',
  'default_roles_except',
  'default_database',
]

export const usersDeclarative: DeclarativeQueryConfig = {
  name: 'users',
  optional: false,
  defaultView: 'auto',
  card: { primary: 'name' },
  description: 'Users account',
  tableCheck: 'system.users',
  sql: `
      SELECT *
      FROM system.users
      ORDER BY name
    `,
  columns: USERS_COLUMNS,
  columnFormats: {},
  expandable: { type: 'config-details', primaryColumns: USERS_COLUMNS },
}

import type { QueryConfig } from '@/types/query-config'

import { createConfigExpandedDetails } from '@/components/data-table/cells/config-expanded-details'

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

export const usersConfig: QueryConfig = {
  name: 'users',
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
  // Expand a row to reveal the host/grantee/role-restriction columns that
  // system.users exposes beyond the table view (grantees_*, host_regexp, …).
  expandable: {
    renderExpanded: createConfigExpandedDetails({
      primaryColumns: USERS_COLUMNS,
    }),
  },
}

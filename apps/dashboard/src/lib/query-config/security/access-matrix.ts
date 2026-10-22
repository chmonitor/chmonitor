/**
 * Raw access-control reads for the Access matrix page (#4123).
 *
 * Each config reads ONE system table, read-only, with explicit columns. The
 * effective-access computation (role closure, partial revokes, readonly cap)
 * happens in TypeScript (`lib/security/access-matrix.ts`) so it can be unit
 * tested, and so a missing `SHOW ...` privilege fails one section, not the
 * page. Every config is `optional` so a server without the table degrades.
 *
 * `system.grants.access_object` is not read: it holds source types, table
 * engines and SET DEFINER users, not data scopes. `is_wildcard` (26.7+)
 * marks a prefix grant such as `d1.t*`; before 26.7 system.grants shows that
 * grant as table `t` with nothing to tell it apart, so older servers still
 * under-report wildcard access (only SHOW GRANTS has it).
 */

import type { QueryConfig } from '@/types/query-config'

const DOCS = 'https://clickhouse.com/docs/en/operations/access-rights'

const SECURITY = { feature: 'security' } as const

/** Row cap of one expanded database column; the UI says when it is hit. */
export const ACCESS_TABLES_LIMIT = 500

const grantsSql = (isWildcard: string) => `
    SELECT
      user_name,
      role_name,
      toString(access_type) AS access_type,
      database,
      table,
      column,
      is_partial_revoke,
      grant_option,
      ${isWildcard}
    FROM system.grants
    ORDER BY user_name, role_name, database, table, column, access_type
  `

export const accessGrantsConfig: QueryConfig = {
  name: 'access-grants',
  description:
    'Privileges granted to users and roles (system.grants). A NULL database or table means all.',
  optional: true,
  tableCheck: 'system.grants',
  docs: DOCS,
  permission: SECURITY,
  sql: [
    { since: '23.8', sql: grantsSql('toUInt8(0) AS is_wildcard') },
    { since: '26.7', sql: grantsSql('is_wildcard') },
  ],
  columns: [
    'user_name',
    'role_name',
    'access_type',
    'database',
    'table',
    'column',
    'is_partial_revoke',
    'grant_option',
    'is_wildcard',
  ],
}

export const accessRoleGrantsConfig: QueryConfig = {
  name: 'access-role-grants',
  description:
    'Roles granted to users and to other roles (system.role_grants).',
  optional: true,
  tableCheck: 'system.role_grants',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT
      user_name,
      role_name,
      granted_role_name,
      granted_role_is_default,
      with_admin_option
    FROM system.role_grants
    ORDER BY user_name, role_name, granted_role_name
  `,
  columns: [
    'user_name',
    'role_name',
    'granted_role_name',
    'granted_role_is_default',
    'with_admin_option',
  ],
}

export const accessUsersConfig: QueryConfig = {
  name: 'access-users',
  description: 'User accounts for the access matrix (system.users).',
  optional: true,
  tableCheck: 'system.users',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT
      name,
      storage,
      toString(auth_type) AS auth_type,
      host_ip,
      host_names,
      default_roles_all,
      default_roles_list,
      default_roles_except,
      default_database
    FROM system.users
    ORDER BY name
  `,
  columns: [
    'name',
    'storage',
    'auth_type',
    'host_ip',
    'host_names',
    'default_roles_all',
    'default_roles_list',
    'default_roles_except',
    'default_database',
  ],
}

export const accessRolesConfig: QueryConfig = {
  name: 'access-roles',
  description: 'Roles for the access matrix (system.roles).',
  optional: true,
  tableCheck: 'system.roles',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT name, storage
    FROM system.roles
    ORDER BY name
  `,
  columns: ['name', 'storage'],
}

export const accessSettingsProfilesConfig: QueryConfig = {
  name: 'access-settings-profiles',
  description:
    'Settings profiles and who they apply to (system.settings_profiles).',
  optional: true,
  tableCheck: 'system.settings_profiles',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT name, storage, apply_to_all, apply_to_list, apply_to_except
    FROM system.settings_profiles
    ORDER BY name
  `,
  columns: [
    'name',
    'storage',
    'apply_to_all',
    'apply_to_list',
    'apply_to_except',
  ],
}

export const accessProfileElementsConfig: QueryConfig = {
  name: 'access-profile-elements',
  description:
    'readonly settings and inherited profiles of profiles, users and roles (system.settings_profile_elements).',
  optional: true,
  tableCheck: 'system.settings_profile_elements',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT
      profile_name,
      user_name,
      role_name,
      setting_name,
      value,
      inherit_profile
    FROM system.settings_profile_elements
    WHERE (setting_name = 'readonly') OR (inherit_profile IS NOT NULL)
    ORDER BY profile_name, user_name, role_name, index
  `,
  columns: [
    'profile_name',
    'user_name',
    'role_name',
    'setting_name',
    'value',
    'inherit_profile',
  ],
}

export const accessDatabasesConfig: QueryConfig = {
  name: 'access-databases',
  description: 'Database names, the columns of the access matrix.',
  optional: true,
  tableCheck: 'system.databases',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT name
    FROM system.databases
    ORDER BY name
  `,
  columns: ['name'],
}

export const accessTablesConfig: QueryConfig = {
  name: 'access-tables',
  description:
    'Table names of one database, loaded when its matrix column is expanded.',
  optional: true,
  tableCheck: 'system.tables',
  docs: DOCS,
  permission: SECURITY,
  sql: `
    SELECT name
    FROM system.tables
    WHERE database = {database:String}
    ORDER BY name
    LIMIT ${ACCESS_TABLES_LIMIT}
  `,
  columns: ['name'],
  defaultParams: { database: '' },
}

export const accessMatrixConfigs: QueryConfig[] = [
  accessGrantsConfig,
  accessRoleGrantsConfig,
  accessUsersConfig,
  accessRolesConfig,
  accessSettingsProfilesConfig,
  accessProfileElementsConfig,
  accessDatabasesConfig,
  accessTablesConfig,
]

/**
 * Raw access-control reads for the Access matrix page (#4123).
 *
 * Each config reads ONE system table, read-only, with explicit columns. The
 * effective-access computation (role closure, partial revokes, readonly cap)
 * happens in TypeScript (`lib/security/access-matrix.ts`) so it can be unit
 * tested, and so a missing `SHOW ...` privilege fails one section, not the
 * page. Every config is `optional` so a server without the table degrades.
 *
 * `system.grants.access_object` is avoided: it only exists on recent
 * releases. The columns used here are present on every supported version.
 */

import type { QueryConfig } from '@/types/query-config'

const DOCS = 'https://clickhouse.com/docs/en/operations/access-rights'

export const accessGrantsConfig: QueryConfig = {
  name: 'access-grants',
  description:
    'Privileges granted to users and roles (system.grants). A NULL database or table means all.',
  optional: true,
  tableCheck: 'system.grants',
  docs: DOCS,
  sql: `
    SELECT
      user_name,
      role_name,
      toString(access_type) AS access_type,
      database,
      table,
      column,
      is_partial_revoke,
      grant_option
    FROM system.grants
    ORDER BY user_name, role_name, database, table, column, access_type
  `,
  columns: [
    'user_name',
    'role_name',
    'access_type',
    'database',
    'table',
    'column',
    'is_partial_revoke',
    'grant_option',
  ],
}

export const accessRoleGrantsConfig: QueryConfig = {
  name: 'access-role-grants',
  description:
    'Roles granted to users and to other roles (system.role_grants).',
  optional: true,
  tableCheck: 'system.role_grants',
  docs: DOCS,
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
  sql: `
    SELECT name
    FROM system.tables
    WHERE database = {database:String}
    ORDER BY name
    LIMIT 500
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

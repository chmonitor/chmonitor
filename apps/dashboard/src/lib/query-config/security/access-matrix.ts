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

import { CLUSTER_FANOUT_SETTINGS } from '@/lib/cluster/fanout-settings'

const DOCS = 'https://clickhouse.com/docs/en/operations/access-rights'

const SECURITY = { feature: 'security' } as const

/** Row cap of one expanded database column; the UI says when it is hit. */
export const ACCESS_TABLES_LIMIT = 500

const GRANT_COLUMNS = [
  'user_name',
  'role_name',
  'access_type',
  'database',
  'table',
  'column',
  'is_partial_revoke',
  'grant_option',
]

const grantsSelect = (isWildcard: string, prefix = '') => `
    SELECT
      ${prefix}user_name,
      role_name,
      toString(access_type) AS access_type,
      database,
      table,
      column,
      is_partial_revoke,
      grant_option,
      ${isWildcard}
    FROM system.grants`

const GRANTS_ORDER =
  'ORDER BY user_name, role_name, database, table, column, access_type'

const grantsSql = (isWildcard: string) => `${grantsSelect(isWildcard)}
    ${GRANTS_ORDER}
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

const ROLE_GRANT_COLUMNS = [
  'user_name',
  'role_name',
  'granted_role_name',
  'granted_role_is_default',
  'with_admin_option',
]

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

export const accessRowPoliciesConfig: QueryConfig = {
  name: 'access-row-policies',
  description:
    'Row policies: the row filter and who it applies to (system.row_policies). An empty table means every table of the database.',
  optional: true,
  tableCheck: 'system.row_policies',
  docs: 'https://clickhouse.com/docs/en/sql-reference/statements/create/row-policy',
  permission: SECURITY,
  sql: `
    SELECT
      name,
      short_name,
      database,
      table,
      select_filter,
      is_restrictive,
      apply_to_all,
      apply_to_list,
      apply_to_except
    FROM system.row_policies
    ORDER BY database, table, short_name
  `,
  columns: [
    'name',
    'short_name',
    'database',
    'table',
    'select_filter',
    'is_restrictive',
    'apply_to_all',
    'apply_to_list',
    'apply_to_except',
  ],
}

const QUOTAS_DOCS = 'https://clickhouse.com/docs/en/operations/quotas'

export const accessQuotasConfig: QueryConfig = {
  name: 'access-quotas',
  description: 'Quotas and who they apply to (system.quotas).',
  optional: true,
  tableCheck: 'system.quotas',
  docs: QUOTAS_DOCS,
  permission: SECURITY,
  sql: `
    SELECT
      name,
      storage,
      keys,
      durations,
      apply_to_all,
      apply_to_list,
      apply_to_except
    FROM system.quotas
    ORDER BY name
  `,
  columns: [
    'name',
    'storage',
    'keys',
    'durations',
    'apply_to_all',
    'apply_to_list',
    'apply_to_except',
  ],
}

/**
 * Limit columns of system.quota_limits. `max_failed_sequential_authentications`
 * is on 24.8 and not on 23.8; `max_queries_per_normalized_hash` is on 26.5 and
 * not on 24.8. The `since` values are those checked releases, not the exact
 * release that added each column, so a server in between reads NULL.
 */
const quotaLimitsSql = (failedAuth: string, perHash: string) => `
    SELECT
      quota_name,
      duration,
      is_randomized_interval,
      max_queries,
      max_query_selects,
      max_query_inserts,
      max_errors,
      max_result_rows,
      max_result_bytes,
      max_read_rows,
      max_read_bytes,
      max_execution_time,
      max_written_bytes,
      ${failedAuth},
      ${perHash}
    FROM system.quota_limits
    ORDER BY quota_name, duration
  `

const QUOTA_METRIC_COLUMNS = [
  'queries',
  'query_selects',
  'query_inserts',
  'errors',
  'result_rows',
  'result_bytes',
  'read_rows',
  'read_bytes',
  'execution_time',
  'written_bytes',
  'failed_sequential_authentications',
  'queries_per_normalized_hash',
]

export const accessQuotaLimitsConfig: QueryConfig = {
  name: 'access-quota-limits',
  description:
    'Limits of each quota interval (system.quota_limits). NULL means no limit.',
  optional: true,
  tableCheck: 'system.quota_limits',
  docs: QUOTAS_DOCS,
  permission: SECURITY,
  sql: [
    {
      since: '23.8',
      sql: quotaLimitsSql(
        'NULL AS max_failed_sequential_authentications',
        'NULL AS max_queries_per_normalized_hash'
      ),
    },
    {
      since: '24.8',
      sql: quotaLimitsSql(
        'max_failed_sequential_authentications',
        'NULL AS max_queries_per_normalized_hash'
      ),
    },
    {
      since: '26.5',
      sql: quotaLimitsSql(
        'max_failed_sequential_authentications',
        'max_queries_per_normalized_hash'
      ),
    },
  ],
  columns: [
    'quota_name',
    'duration',
    'is_randomized_interval',
    ...QUOTA_METRIC_COLUMNS.map((m) => `max_${m}`),
  ],
}

/**
 * system.quotas_usage (plural) has every quota key of every user, where
 * system.quota_usage only has the current user. Same version split as
 * quota_limits.
 */
const quotasUsageSql = (failedAuth: string, perHash: string) => `
    SELECT
      quota_name,
      quota_key,
      is_current,
      end_time,
      duration,
      queries,
      max_queries,
      query_selects,
      max_query_selects,
      query_inserts,
      max_query_inserts,
      errors,
      max_errors,
      result_rows,
      max_result_rows,
      result_bytes,
      max_result_bytes,
      read_rows,
      max_read_rows,
      read_bytes,
      max_read_bytes,
      execution_time,
      max_execution_time,
      written_bytes,
      max_written_bytes,
      ${failedAuth},
      ${perHash}
    FROM system.quotas_usage
    ORDER BY quota_name, quota_key, duration
  `

export const accessQuotasUsageConfig: QueryConfig = {
  name: 'access-quotas-usage',
  description:
    'Current quota consumption of every quota key (system.quotas_usage).',
  optional: true,
  tableCheck: 'system.quotas_usage',
  docs: QUOTAS_DOCS,
  permission: SECURITY,
  sql: [
    {
      since: '23.8',
      sql: quotasUsageSql(
        `NULL AS failed_sequential_authentications,
      NULL AS max_failed_sequential_authentications`,
        `NULL AS queries_per_normalized_hash,
      NULL AS max_queries_per_normalized_hash`
      ),
    },
    {
      since: '24.8',
      sql: quotasUsageSql(
        `failed_sequential_authentications,
      max_failed_sequential_authentications`,
        `NULL AS queries_per_normalized_hash,
      NULL AS max_queries_per_normalized_hash`
      ),
    },
    {
      since: '26.5',
      sql: quotasUsageSql(
        `failed_sequential_authentications,
      max_failed_sequential_authentications`,
        `queries_per_normalized_hash,
      max_queries_per_normalized_hash`
      ),
    },
  ],
  columns: [
    'quota_name',
    'quota_key',
    'is_current',
    'end_time',
    'duration',
    ...QUOTA_METRIC_COLUMNS.flatMap((m) => [m, `max_${m}`]),
  ],
}

/**
 * Replica drift (#4123), opt-in. The same two reads as above, run on every
 * replica of `{cluster}` through clusterAllReplicas, tagged with the replica's
 * hostName(). Read-only. `skip_unavailable_shards` makes an unreachable
 * replica vanish from the result instead of failing it, so
 * `access-replicas` reports which replicas answered at all: a replica with
 * no grants still answers with a row, an unreachable one does not.
 */
const REPLICA_DOCS =
  'https://clickhouse.com/docs/en/sql-reference/table-functions/cluster'

const REPLICA_COLUMNS = (columns: string[]) => ['replica', ...columns]

const replicaGrantsSql = (isWildcard: string) => `
    SELECT ${REPLICA_COLUMNS([...GRANT_COLUMNS, 'is_wildcard']).join(', ')}
    FROM clusterAllReplicas(
      {cluster:String},
      view(${grantsSelect(isWildcard, 'hostName() AS replica, ')}
      )
    )
    ORDER BY replica, ${GRANTS_ORDER.replace('ORDER BY ', '')}
    ${CLUSTER_FANOUT_SETTINGS}
  `

export const accessReplicaGrantsConfig: QueryConfig = {
  name: 'access-replica-grants',
  description:
    'Privileges (system.grants) as each replica of a cluster sees them, for the replica drift check.',
  optional: true,
  tableCheck: 'system.grants',
  docs: REPLICA_DOCS,
  permission: SECURITY,
  sql: [
    { since: '23.8', sql: replicaGrantsSql('toUInt8(0) AS is_wildcard') },
    { since: '26.7', sql: replicaGrantsSql('is_wildcard') },
  ],
  columns: REPLICA_COLUMNS([...GRANT_COLUMNS, 'is_wildcard']),
  defaultParams: { cluster: '' },
}

export const accessReplicaRoleGrantsConfig: QueryConfig = {
  name: 'access-replica-role-grants',
  description:
    'Role grants (system.role_grants) as each replica of a cluster sees them, for the replica drift check.',
  optional: true,
  tableCheck: 'system.role_grants',
  docs: REPLICA_DOCS,
  permission: SECURITY,
  sql: `
    SELECT ${REPLICA_COLUMNS(ROLE_GRANT_COLUMNS).join(', ')}
    FROM clusterAllReplicas(
      {cluster:String},
      view(
        SELECT
          hostName() AS replica,
          ${ROLE_GRANT_COLUMNS.join(',\n          ')}
        FROM system.role_grants
      )
    )
    ORDER BY replica, user_name, role_name, granted_role_name
    ${CLUSTER_FANOUT_SETTINGS}
  `,
  columns: REPLICA_COLUMNS(ROLE_GRANT_COLUMNS),
  defaultParams: { cluster: '' },
}

export const accessReplicasConfig: QueryConfig = {
  name: 'access-replicas',
  description:
    'Replicas of a cluster that answered, one row each (system.grants row count), to tell a skipped replica from a replica without drift.',
  optional: true,
  tableCheck: 'system.grants',
  docs: REPLICA_DOCS,
  permission: SECURITY,
  sql: `
    SELECT replica, grants
    FROM clusterAllReplicas(
      {cluster:String},
      view(
        SELECT hostName() AS replica, count() AS grants
        FROM system.grants
      )
    )
    ORDER BY replica
    ${CLUSTER_FANOUT_SETTINGS}
  `,
  columns: ['replica', 'grants'],
  defaultParams: { cluster: '' },
}

export const accessClustersConfig: QueryConfig = {
  name: 'access-clusters',
  description:
    'Cluster members (system.clusters), to pick the cluster for the replica drift check and know which replicas to expect.',
  optional: true,
  tableCheck: 'system.clusters',
  docs: REPLICA_DOCS,
  permission: SECURITY,
  sql: `
    SELECT cluster, host_name, host_address, port, is_local
    FROM system.clusters
    ORDER BY cluster, shard_num, replica_num
  `,
  columns: ['cluster', 'host_name', 'host_address', 'port', 'is_local'],
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
  accessRowPoliciesConfig,
  accessQuotasConfig,
  accessQuotaLimitsConfig,
  accessQuotasUsageConfig,
  accessReplicaGrantsConfig,
  accessReplicaRoleGrantsConfig,
  accessReplicasConfig,
  accessClustersConfig,
]

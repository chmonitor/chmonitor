import type {
  ClusterMemberRow,
  ReplicaGrantRow,
  ReplicaRoleGrantRow,
} from '@/lib/security/access-drift'
import type {
  GrantRow,
  ProfileElementRow,
  RoleGrantRow,
  SettingsProfileRow,
} from '@/lib/security/access-matrix'
import type {
  QuotaLimitRow,
  QuotaRow,
  QuotaUsageRow,
  RowPolicyRow,
} from '@/lib/security/access-policies'

import { useTableData } from '@/lib/query/use-table-data'
import { useHostId } from '@/lib/swr'

export interface UserRow {
  name: string
  storage: string
  auth_type: string
  host_ip: string[]
  host_names: string[]
  default_roles_all: number
  default_roles_list: string[]
  default_roles_except: string[]
  default_database: string
}

export interface RoleRow {
  name: string
  storage: string
}

/** One section of the page: its rows, or the error that stopped it. */
export interface Section<T> {
  data: T[]
  error: Error | undefined
  isLoading: boolean
  /** The server row cap was hit, so the section may be incomplete. */
  truncated: boolean
  refresh: () => Promise<void>
}

function useSection<T>(
  name: string,
  hostId: number,
  params?: Record<string, string>,
  enabled = true
): Section<T> {
  const { data, metadata, error, isPending, refresh } = useTableData<T>(
    name,
    hostId,
    params,
    undefined,
    undefined,
    undefined,
    enabled
  )
  return {
    data,
    error,
    isLoading: enabled && isPending && !error,
    truncated:
      (metadata as { resultRowsTruncated?: boolean } | undefined)
        ?.resultRowsTruncated === true,
    refresh,
  }
}

/**
 * Every section is fetched on its own, so a missing `SHOW ROLES` (for
 * example) fails the roles section only and the matrix still renders.
 */
export function useAccessData() {
  const hostId = useHostId()
  return {
    hostId,
    grants: useSection<GrantRow>('access-grants', hostId),
    roleGrants: useSection<RoleGrantRow>('access-role-grants', hostId),
    users: useSection<UserRow>('access-users', hostId),
    roles: useSection<RoleRow>('access-roles', hostId),
    profiles: useSection<SettingsProfileRow>(
      'access-settings-profiles',
      hostId
    ),
    profileElements: useSection<ProfileElementRow>(
      'access-profile-elements',
      hostId
    ),
    databases: useSection<{ name: string }>('access-databases', hostId),
    rowPolicies: useSection<RowPolicyRow>('access-row-policies', hostId),
    quotas: useSection<QuotaRow>('access-quotas', hostId),
    quotaLimits: useSection<QuotaLimitRow>('access-quota-limits', hostId),
    quotasUsage: useSection<QuotaUsageRow>('access-quotas-usage', hostId),
    clusters: useSection<ClusterMemberRow>('access-clusters', hostId),
  }
}

export type AccessData = ReturnType<typeof useAccessData>

/**
 * Grants of every replica of `cluster`. Nothing is fetched until a cluster
 * is given, so the page stays on one node unless the reader opts in.
 */
export function useReplicaData(cluster: string | null) {
  const hostId = useHostId()
  const params = { cluster: cluster ?? '' }
  const enabled = cluster !== null
  return {
    grants: useSection<ReplicaGrantRow>(
      'access-replica-grants',
      hostId,
      params,
      enabled
    ),
    roleGrants: useSection<ReplicaRoleGrantRow>(
      'access-replica-role-grants',
      hostId,
      params,
      enabled
    ),
    replicas: useSection<{ replica: string; grants: number }>(
      'access-replicas',
      hostId,
      params,
      enabled
    ),
  }
}

export type ReplicaData = ReturnType<typeof useReplicaData>

/** Table names of one database, for an expanded matrix column. */
export function useDatabaseTables(database: string | null) {
  const hostId = useHostId()
  const { data, isPending, error } = useTableData<{ name: string }>(
    'access-tables',
    hostId,
    { database: database ?? '' }
  )
  return {
    tables: database ? data.map((r) => r.name) : [],
    isLoading: database !== null && isPending && !error,
    error: database ? error : undefined,
  }
}

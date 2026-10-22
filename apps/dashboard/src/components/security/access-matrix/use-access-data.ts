import type {
  GrantRow,
  ProfileElementRow,
  RoleGrantRow,
  SettingsProfileRow,
} from '@/lib/security/access-matrix'

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

function useSection<T>(name: string, hostId: number): Section<T> {
  const { data, metadata, error, isPending, refresh } = useTableData<T>(
    name,
    hostId
  )
  return {
    data,
    error,
    isLoading: isPending && !error,
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
  }
}

export type AccessData = ReturnType<typeof useAccessData>

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

import type { QueryClient } from '@tanstack/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { SourceEngine } from '@chm/types'

import { useClerkUserId } from '@/components/assistant-ui/use-clerk-user-id'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface UserConnectionInfo {
  id: string
  name: string
  host: string
  user: string
  hostId: number
  /** Source engine (orthogonal to `source`); defaults to 'clickhouse'. */
  engine: SourceEngine
  source: 'database'
  createdAt?: number
  updatedAt?: number
}

interface UserConnectionsResponse {
  success: boolean
  data: UserConnectionInfo[]
}

/** Prefix for all user-connection query keys (used for cache eviction). */
export const USER_CONNECTIONS_QUERY_PREFIX = '/api/v1/user-connections' as const

export function userConnectionsQueryKey(userId: string | null) {
  return [USER_CONNECTIONS_QUERY_PREFIX, userId ?? 'signed-out'] as const
}

export function clearUserConnectionsCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: [USER_CONNECTIONS_QUERY_PREFIX] })
}

const useClerkUserIdOrNull: () => string | null = isClerkEnabled()
  ? useClerkUserId
  : () => null

export function useUserConnections(enabled = true) {
  const featureEnabled = isFeatureEnabled('userConnectionsDb')
  const userId = useClerkUserIdOrNull()
  const queryEnabled = enabled && featureEnabled && userId !== null

  const query = useQuery({
    queryKey: userConnectionsQueryKey(userId),
    queryFn: async () => {
      const response = await apiFetch('/api/v1/user-connections')
      await throwIfNotOk(response, 'Failed to load user connections')
      const json = (await response.json()) as UserConnectionsResponse
      return json.data ?? []
    },
    enabled: queryEnabled,
    staleTime: 30_000,
  })

  return {
    connections: queryEnabled ? (query.data ?? []) : [],
    isLoading: queryEnabled && query.isLoading,
    error: queryEnabled ? query.error : null,
    refetch: query.refetch,
    featureEnabled,
    isSignedIn: userId !== null,
  }
}

export function useUserConnectionsMutations() {
  const queryClient = useQueryClient()
  const userId = useClerkUserIdOrNull()

  const invalidate = () => {
    if (userId) {
      queryClient.invalidateQueries({
        queryKey: userConnectionsQueryKey(userId),
      })
    }
  }

  const createConnection = async (input: {
    name: string
    host: string
    user: string
    password: string
    /** Omit to default to 'clickhouse' (validated + defaulted server-side). */
    engine?: SourceEngine
    /** Postgres-only (engine === 'postgres'). */
    port?: number
    database?: string
    sslmode?: string
    /** Optional PeerDB monitoring link (any engine). */
    peerdbApiUrl?: string
    peerdbAuthScheme?: 'basic' | 'bearer'
    peerdbAuthSecret?: string
  }): Promise<{
    success: boolean
    data: UserConnectionInfo
  }> => {
    const response = await apiFetch('/api/v1/user-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to save connection')
    invalidate()
    return response.json() as Promise<{
      success: boolean
      data: UserConnectionInfo
    }>
  }

  const updateConnection = async (
    id: string,
    input: {
      name: string
      host: string
      user: string
      /** Omit/blank to leave the stored password unchanged (server-side guard). */
      password?: string
    }
  ): Promise<{
    success: boolean
    data: UserConnectionInfo
  }> => {
    const response = await apiFetch(`/api/v1/user-connections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to update connection')
    invalidate()
    return response.json() as Promise<{
      success: boolean
      data: UserConnectionInfo
    }>
  }

  const deleteConnection = async (id: string) => {
    const response = await apiFetch(`/api/v1/user-connections/${id}`, {
      method: 'DELETE',
    })
    await throwIfNotOk(response, 'Failed to delete connection')
    invalidate()
  }

  return { createConnection, updateConnection, deleteConnection, invalidate }
}

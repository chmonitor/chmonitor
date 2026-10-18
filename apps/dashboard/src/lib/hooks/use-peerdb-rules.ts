import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { HealthDefinitionSource } from '@/lib/health/declarative/merge'
import type { PeerDBRule } from '@/lib/peerdb/alert-rules'

import { useCloudAccess } from '@/lib/cloud/use-cloud-access'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface PeerDBRuleInfo extends PeerDBRule {
  /** `file`/`env` rules are read-only; absent = `d1`. */
  source?: HealthDefinitionSource
}

export type PeerDBRuleInput = Omit<PeerDBRule, 'id'> & { id?: string }

export const PEERDB_RULES_QUERY_KEY = ['/api/v1/health/peerdb-rules'] as const

export function usePeerDBRules(enabled = true) {
  const canRead = useCloudAccess() === 'open'
  const query = useQuery({
    queryKey: PEERDB_RULES_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/peerdb-rules')
      await throwIfNotOk(response, 'Failed to load PeerDB rules')
      const json = (await response.json()) as { rules?: PeerDBRuleInfo[] }
      return json.rules ?? []
    },
    enabled: enabled && canRead,
    staleTime: 15_000,
  })
  return {
    rules: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function usePeerDBRulesMutations() {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: PEERDB_RULES_QUERY_KEY })

  const saveRule = async (input: PeerDBRuleInput): Promise<void> => {
    const response = await apiFetch('/api/v1/health/peerdb-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to save PeerDB rule')
    await invalidate()
  }

  const deleteRule = async (id: string): Promise<void> => {
    const response = await apiFetch(
      `/api/v1/health/peerdb-rules?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    await throwIfNotOk(response, 'Failed to delete PeerDB rule')
    await invalidate()
  }

  return { saveRule, deleteRule }
}

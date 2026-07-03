/**
 * Data hook for the Active Alerts panel (plan 29).
 *
 * Combines two GET endpoints — `/api/v1/health/findings` (currently-firing
 * conditions, computed read-only) and `/api/v1/health/ack` (active ACKs) —
 * plus the ACK/un-ACK mutations, mirroring the fetch/error conventions of
 * `use-alert-history.ts`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AckDurationKey, AlertAck } from '@/lib/health/alert-ack-store'
import type { CurrentFinding } from '@/lib/health/current-findings'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

const REFRESH_INTERVAL_MS = 30_000

const FINDINGS_QUERY_KEY = ['/api/v1/health/findings'] as const
const ACKS_QUERY_KEY = ['/api/v1/health/ack'] as const

interface FindingsResponse {
  success: boolean
  findings: CurrentFinding[]
}

interface AcksResponse {
  success: boolean
  acks: AlertAck[]
}

function refetchInterval(): number | false {
  return typeof document !== 'undefined' && document.hidden
    ? false
    : REFRESH_INTERVAL_MS
}

export interface UseActiveAlertsResult {
  findings: CurrentFinding[]
  acks: AlertAck[]
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  refetch: () => void
}

export function useActiveAlerts(): UseActiveAlertsResult {
  const findingsQuery = useQuery<FindingsResponse, Error>({
    queryKey: FINDINGS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/findings')
      await throwIfNotOk(response, 'Failed to fetch current findings')
      return response.json() as Promise<FindingsResponse>
    },
    staleTime: REFRESH_INTERVAL_MS * 0.9,
    refetchInterval,
    placeholderData: (prev) => prev,
  })

  const acksQuery = useQuery<AcksResponse, Error>({
    queryKey: ACKS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/ack')
      await throwIfNotOk(response, 'Failed to fetch active acks')
      return response.json() as Promise<AcksResponse>
    },
    staleTime: REFRESH_INTERVAL_MS * 0.9,
    refetchInterval,
    placeholderData: (prev) => prev,
  })

  return {
    findings: findingsQuery.data?.findings ?? [],
    acks: acksQuery.data?.acks ?? [],
    isLoading:
      (findingsQuery.isPending && findingsQuery.isFetching) ||
      (acksQuery.isPending && acksQuery.isFetching),
    isFetching: findingsQuery.isFetching || acksQuery.isFetching,
    error: findingsQuery.error ?? acksQuery.error,
    refetch: () => {
      void findingsQuery.refetch()
      void acksQuery.refetch()
    },
  }
}

export interface AckParams {
  hostId: number
  ruleId: string
  duration: AckDurationKey
  note?: string
}

/** ACK/snooze + un-ACK mutations, invalidating the acks query on success. */
export function useAckMutations() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ACKS_QUERY_KEY })
  }

  const ack = useMutation({
    mutationFn: async (params: AckParams) => {
      const response = await apiFetch('/api/v1/health/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      await throwIfNotOk(response, 'Failed to acknowledge alert')
      return response.json() as Promise<{ success: boolean; ack: AlertAck }>
    },
    onSuccess: invalidate,
  })

  const clear = useMutation({
    mutationFn: async ({
      hostId,
      ruleId,
    }: {
      hostId: number
      ruleId: string
    }) => {
      const params = new URLSearchParams({
        hostId: String(hostId),
        ruleId,
      })
      const response = await apiFetch(`/api/v1/health/ack?${params}`, {
        method: 'DELETE',
      })
      await throwIfNotOk(response, 'Failed to clear ACK')
    },
    onSuccess: invalidate,
  })

  return { ack, clear }
}

/**
 * Outbound webhook subscriptions (plan 44). Mirrors
 * `use-user-connections.ts`'s query/mutation split exactly — same Clerk +
 * feature-flag gating, same `apiFetch`/`throwIfNotOk` helpers.
 */

import type { QueryClient } from '@tanstack/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useClerkUserId } from '@/components/assistant-ui/use-clerk-user-id'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface WebhookSubscriptionInfo {
  id: string
  url: string
  eventTypes: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** Only the create response includes this — reveal-once. */
export interface WebhookSubscriptionCreated extends WebhookSubscriptionInfo {
  secret: string
}

export interface WebhookDeliveryInfo {
  id: string
  subscriptionId: string
  eventType: string
  status: 'delivered' | 'failed' | 'dead'
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
  eventTime: number
  deliveredAt: number | null
}

export interface WebhookDeliveryOutcome {
  status: 'delivered' | 'failed' | 'dead'
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
}

export const WEBHOOK_SUBSCRIPTIONS_QUERY_PREFIX =
  '/api/v1/webhooks/subscriptions' as const

export function webhookSubscriptionsQueryKey(userId: string | null) {
  return [WEBHOOK_SUBSCRIPTIONS_QUERY_PREFIX, userId ?? 'signed-out'] as const
}

export function clearWebhookSubscriptionsCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: [WEBHOOK_SUBSCRIPTIONS_QUERY_PREFIX] })
}

const useClerkUserIdOrNull: () => string | null = isClerkEnabled()
  ? useClerkUserId
  : () => null

export function useWebhookSubscriptions(enabled = true) {
  const featureEnabled = isFeatureEnabled('webhookSubscriptions')
  const userId = useClerkUserIdOrNull()
  const queryEnabled = enabled && featureEnabled && userId !== null

  const query = useQuery({
    queryKey: webhookSubscriptionsQueryKey(userId),
    queryFn: async () => {
      const response = await apiFetch('/api/v1/webhooks/subscriptions')
      await throwIfNotOk(response, 'Failed to load webhook subscriptions')
      const json = (await response.json()) as {
        success: boolean
        data: WebhookSubscriptionInfo[]
      }
      return json.data ?? []
    },
    enabled: queryEnabled,
    staleTime: 30_000,
  })

  return {
    subscriptions: queryEnabled ? (query.data ?? []) : [],
    isLoading: queryEnabled && query.isLoading,
    error: queryEnabled ? query.error : null,
    refetch: query.refetch,
    featureEnabled,
    isSignedIn: userId !== null,
  }
}

export function useWebhookSubscriptionsMutations() {
  const queryClient = useQueryClient()
  const userId = useClerkUserIdOrNull()

  const invalidate = () => {
    if (userId) {
      queryClient.invalidateQueries({
        queryKey: webhookSubscriptionsQueryKey(userId),
      })
    }
  }

  const createSubscription = async (input: {
    url: string
    eventTypes: string[]
  }): Promise<WebhookSubscriptionCreated> => {
    const response = await apiFetch('/api/v1/webhooks/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to create webhook subscription')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      data: WebhookSubscriptionCreated
    }
    return json.data
  }

  const updateSubscription = async (
    id: string,
    patch: { url?: string; eventTypes?: string[]; enabled?: boolean }
  ): Promise<WebhookSubscriptionInfo> => {
    const response = await apiFetch(`/api/v1/webhooks/subscriptions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await throwIfNotOk(response, 'Failed to update webhook subscription')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      data: WebhookSubscriptionInfo
    }
    return json.data
  }

  const deleteSubscription = async (id: string): Promise<void> => {
    const response = await apiFetch(`/api/v1/webhooks/subscriptions/${id}`, {
      method: 'DELETE',
    })
    await throwIfNotOk(response, 'Failed to delete webhook subscription')
    invalidate()
  }

  const sendTestPing = async (id: string): Promise<WebhookDeliveryOutcome> => {
    const response = await apiFetch(
      `/api/v1/webhooks/subscriptions/${id}/test`,
      { method: 'POST' }
    )
    await throwIfNotOk(response, 'Failed to send test webhook')
    const json = (await response.json()) as {
      success: boolean
      data: WebhookDeliveryOutcome
    }
    return json.data
  }

  return {
    createSubscription,
    updateSubscription,
    deleteSubscription,
    sendTestPing,
    invalidate,
  }
}

/** Recent deliveries for one subscription — fetched on demand (expand-to-view), not prefetched for every row. */
export function useWebhookDeliveries(subscriptionId: string | null) {
  const query = useQuery({
    queryKey: [
      WEBHOOK_SUBSCRIPTIONS_QUERY_PREFIX,
      subscriptionId,
      'deliveries',
    ],
    queryFn: async () => {
      const response = await apiFetch(
        `/api/v1/webhooks/subscriptions/${subscriptionId}/deliveries`
      )
      await throwIfNotOk(response, 'Failed to load webhook deliveries')
      const json = (await response.json()) as {
        success: boolean
        data: WebhookDeliveryInfo[]
      }
      return json.data ?? []
    },
    enabled: subscriptionId !== null,
    staleTime: 10_000,
  })

  return {
    deliveries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  }
}

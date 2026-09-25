'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  CustomWebhookFormat,
  CustomWebhookTargetPublic,
} from '@/lib/health/custom-webhook-targets'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export type { CustomWebhookTargetPublic }

export interface CustomWebhookTargetsResponse {
  success: boolean
  targets: CustomWebhookTargetPublic[]
  storage: 'ok' | 'unavailable' | 'unknown'
}

export interface CustomWebhookTargetInput {
  id?: string
  name: string
  /** Empty keeps the existing secret URL when `id` is supplied. */
  url?: string
  enabled: boolean
  format: CustomWebhookFormat
  minSeverity: 'warning' | 'critical' | null
  titleTemplate: string
  bodyTemplate: string
  headers: Record<string, string>
}

export interface CustomWebhookPreviewResponse {
  success: boolean
  preview: {
    format: CustomWebhookFormat
    adapterId: string
    redactedUrl: string
    headers: Record<string, string>
    body: unknown
    bodyJson: string
    truncated: boolean
  }
  sent?: boolean
}

export const CUSTOM_WEBHOOK_TARGETS_QUERY_KEY = [
  '/api/v1/health/webhook-targets',
] as const

async function jsonOrThrow<T>(response: Response, message: string): Promise<T> {
  await throwIfNotOk(response, message)
  return (await response.json()) as T
}

export function useCustomWebhookTargets() {
  const query = useQuery({
    queryKey: CUSTOM_WEBHOOK_TARGETS_QUERY_KEY,
    queryFn: () =>
      apiFetch('/api/v1/health/webhook-targets').then((response) =>
        jsonOrThrow<CustomWebhookTargetsResponse>(
          response,
          'Failed to load custom webhook targets'
        )
      ),
    staleTime: 15_000,
  })

  return {
    targets: query.data?.targets ?? [],
    storage: query.data?.storage ?? 'unknown',
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useCustomWebhookTargetMutations() {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: CUSTOM_WEBHOOK_TARGETS_QUERY_KEY,
    })

  const save = async (input: CustomWebhookTargetInput) => {
    const response = await apiFetch('/api/v1/health/webhook-targets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const result = await jsonOrThrow<{
      success: boolean
      target: CustomWebhookTargetPublic | null
    }>(response, 'Failed to save custom webhook target')
    await invalidate()
    return result.target
  }

  const remove = async (id: string) => {
    const response = await apiFetch(
      `/api/v1/health/webhook-targets?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    await jsonOrThrow<{ success: boolean }>(
      response,
      'Failed to reset custom webhook target'
    )
    await invalidate()
  }

  const preview = async (
    input: Partial<CustomWebhookTargetInput> & { send?: boolean }
  ) => {
    const response = await apiFetch('/api/v1/health/webhook-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return jsonOrThrow<CustomWebhookPreviewResponse>(
      response,
      input.send
        ? 'Custom webhook test failed'
        : 'Failed to preview custom webhook'
    )
  }

  return { save, remove, preview, invalidate }
}

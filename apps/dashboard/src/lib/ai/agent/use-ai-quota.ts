'use client'

// Cloud-only daily-message meter. Reads GET /api/v1/billing/usage defensively: OSS, errors, malformed bodies and unlimited plans all resolve to show: false, so it never affects the agent.

import { useQuery } from '@tanstack/react-query'

import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { apiFetch } from '@/lib/swr/api-fetch'
import { NON_CRITICAL_RETRY, visibilityAwareInterval } from '@/lib/swr/config'

export interface AiQuota {
  used: number
  /** Daily included-message cap, or null when the plan is unlimited. */
  limit: number | null
  /** Messages left before the cap, or null when unlimited. Never negative. */
  remaining: number | null
  /** True when the plan does not cap daily messages at all. */
  unlimited: boolean
}

export interface UseAiQuotaResult extends AiQuota {
  isLoading: boolean
  error: Error | null
  show: boolean
}

const HIDDEN: AiQuota = {
  used: 0,
  limit: null,
  remaining: null,
  unlimited: true,
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Defensively extract the daily AI meter from the usage endpoint's response.
 *
 * The sibling slice owns the exact shape, so we accept a few plausible layouts:
 * the meter fields at the top level of `data`, or nested under an `aiDaily` /
 * `ai` / `aiMessages` key. Anything we cannot make sense of resolves to the
 * hidden default.
 */
export function parseQuota(payload: unknown): AiQuota {
  if (!payload || typeof payload !== 'object') return HIDDEN

  const root = payload as Record<string, unknown>
  const data = (root.data as Record<string, unknown> | undefined) ?? undefined
  const candidates: unknown[] = [
    root.data ?? root,
    data?.aiDaily,
    data?.ai,
    data?.aiMessages,
    root.aiDaily,
    root.ai,
    root.aiMessages,
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const meter = candidate as Record<string, unknown>
    const used = toFiniteNumber(meter.used)
    if (used === null) continue

    const limit = toFiniteNumber(meter.limit)
    const unlimited =
      meter.unlimited === true || meter.limit === null || limit === null
    if (unlimited)
      return { used, limit: null, remaining: null, unlimited: true }

    const remaining =
      toFiniteNumber(meter.remaining) ?? Math.max(0, (limit ?? 0) - used)
    return { used, limit, remaining, unlimited: false }
  }

  return HIDDEN
}

export function useAiQuota(): UseAiQuotaResult {
  const cloud = isCloudModeClient()

  const query = useQuery({
    queryKey: ['billing', 'ai-usage'],
    enabled: cloud,
    staleTime: 30_000,
    refetchInterval: visibilityAwareInterval(60_000),
    refetchOnWindowFocus: true,
    // The endpoint may not exist yet (sibling slice) or the session cookie may
    // be briefly stale — do not spam retries; a single miss just hides it.
    // Non-critical always-on poll: share the reduced retry budget.
    retry: NON_CRITICAL_RETRY,
    queryFn: async (): Promise<AiQuota> => {
      const res = await apiFetch('/api/v1/billing/usage')
      if (!res.ok) throw new Error(`Usage request failed (${res.status})`)
      const json = (await res.json().catch(() => null)) as unknown
      // Envelope may report failure without an HTTP error status.
      if (
        json &&
        typeof json === 'object' &&
        'success' in json &&
        (json as { success?: unknown }).success === false
      ) {
        throw new Error('Usage request unsuccessful')
      }
      return parseQuota(json)
    },
  })

  const data = query.data ?? HIDDEN
  const error = query.error instanceof Error ? query.error : null

  const show =
    cloud &&
    !query.isLoading &&
    error === null &&
    query.data !== undefined &&
    !data.unlimited &&
    data.limit !== null

  return {
    used: data.used,
    limit: data.limit,
    remaining: data.remaining,
    unlimited: data.unlimited,
    isLoading: cloud && query.isLoading,
    error,
    show,
  }
}

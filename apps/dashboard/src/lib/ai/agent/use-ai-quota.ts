'use client'

/**
 * useAiQuota — client hook for the agent's daily AI-message allowance.
 *
 * Cloud (SaaS) only. Free-tier users get a small daily included-message quota
 * (see `checkAiDailyLimit` in `lib/billing/entitlements.ts`); today that cap is
 * only surfaced by a 402 mid-conversation, so a Free user has no forewarning of
 * how many messages remain. This hook powers a subtle "X / N messages today"
 * indicator in the agent chrome.
 *
 * Design:
 * - Reads `GET /api/v1/billing/usage` (added by a sibling slice — B3). This hook
 *   consumes it defensively: any error, absence, or malformed body resolves to
 *   `show: false` so the indicator simply does not render. It never blocks or
 *   degrades the agent, and it never throws.
 * - OSS / self-hosted (not cloud mode) short-circuits to `show: false` and does
 *   not even hit the endpoint — the daily meter is a Cloud concept.
 * - Unlimited plans (Enterprise / BYOK, `limit == null`) also render nothing.
 */

import { useQuery } from '@tanstack/react-query'

import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { apiFetch } from '@/lib/swr/api-fetch'
import { visibilityAwareInterval } from '@/lib/swr/config'

export interface AiQuota {
  /** Messages already sent today. */
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
  /**
   * Whether the "X / N messages today" indicator should render at all. True only
   * in cloud mode, when a bounded quota was resolved successfully. False on OSS,
   * on any fetch/parse error, on absence of the endpoint, and for unlimited
   * plans — so callers can `if (!quota.show) return null` unconditionally.
   */
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
 * `ai` key. Anything we cannot make sense of resolves to the hidden default.
 */
function parseQuota(payload: unknown): AiQuota {
  if (!payload || typeof payload !== 'object') return HIDDEN

  const root = payload as Record<string, unknown>
  const candidates: unknown[] = [
    root.data ?? root,
    (root.data as Record<string, unknown> | undefined)?.aiDaily,
    (root.data as Record<string, unknown> | undefined)?.ai,
    root.aiDaily,
    root.ai,
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

/**
 * Reports the current user's daily AI-message allowance for the agent UI.
 *
 * Fails safe in every dimension: OSS builds and any endpoint error resolve to
 * `show: false`, so the indicator is purely additive and can never break the
 * agent.
 */
export function useAiQuota(): UseAiQuotaResult {
  const cloud = isCloudModeClient()

  const query = useQuery({
    queryKey: ['billing', 'ai-usage'],
    enabled: cloud,
    staleTime: 30_000,
    // Poll gently so the indicator ticks down as the user sends messages,
    // without hammering the endpoint.
    refetchInterval: visibilityAwareInterval(60_000),
    refetchOnWindowFocus: true,
    // The endpoint may not exist yet (sibling slice) or the session cookie may
    // be briefly stale — do not spam retries; a single miss just hides it.
    retry: 1,
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

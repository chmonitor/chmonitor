import { trackEvent } from '@/lib/analytics/analytics'
import { classifyBillingLimit } from '@/lib/api/error-handler/error-classifier'
import { showPaywall } from '@/lib/billing/paywall-store'

/**
 * Reads a cloned 402 response body and, when it's a recognized billing-limit
 * shape, opens the global PaywallModal. Best-effort and silent: a malformed
 * body just means nothing to classify — the caller's own error handling
 * (`throwIfNotOk` et al.) still runs unaffected since it reads the original,
 * unconsumed response.
 *
 * Also fires the `paywall_hit` funnel event — this is the single chokepoint
 * where a real billing-limit 402 is classified, so it's the most accurate
 * place to mark "user hit the paywall" (vs. `upgrade_click`, which only fires
 * if they act on it).
 */
async function maybeTriggerPaywall(response: Response): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const body: unknown = await response.json()
    const classification = classifyBillingLimit(response.status, body)
    if (classification) {
      showPaywall(classification)
      trackEvent('paywall_hit', {
        reason: classification.reason,
        plan_id: classification.planId,
      })
    }
  } catch {
    // Not JSON, or shape we don't recognize — nothing to classify.
  }
}

/**
 * Fetch wrapper for first-party dashboard API calls (ported from the Next app).
 *
 * Intercepts non-stream HTML error responses (e.g. Cloudflare's "Worker
 * exceeded resource limits" page) so they surface as real errors rather than
 * being rendered as content. Framework-agnostic — used by the TanStack Query
 * hooks as the queryFn fetcher.
 *
 * Also the one chokepoint shared by every first-party request — plain
 * TanStack Query hooks AND the AI agent's chat transport (which wraps this as
 * its custom `fetch`, see agent-runtime-provider.tsx) — so it doubles as
 * where a billing-limit 402 (host/seat/ai_daily/ai_budget) gets classified and
 * routed to the global PaywallModal instead of surfacing as a raw error.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response =
    init === undefined ? await fetch(input) : await fetch(input, init)

  const contentType = response.headers?.get?.('content-type') ?? ''
  const isStream =
    contentType.includes('text/event-stream') ||
    contentType.includes('application/json') ||
    contentType.includes('application/x-ndjson')

  if (response.ok && isStream) return response

  if (
    !response.ok &&
    response.status === 402 &&
    contentType.includes('application/json')
  ) {
    await maybeTriggerPaywall(response.clone())
  }

  if (!response.ok && !isStream && contentType.includes('text/html')) {
    const bodyText = await response.clone().text()
    const truncated = bodyText.slice(0, 500)
    const isCfResourceLimit = /Worker exceeded resource limits/i.test(bodyText)
    const message = isCfResourceLimit
      ? 'Cloudflare Worker exceeded resource limits (CPU/memory). Try a smaller question, disable some tools, or use a faster model.'
      : `Request failed (${response.status} ${response.statusText || 'Error'})`
    const err = new Error(message)
    ;(err as { details?: string }).details = truncated
    throw err
  }

  return response
}

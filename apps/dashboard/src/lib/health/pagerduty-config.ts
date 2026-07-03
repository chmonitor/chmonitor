/**
 * PagerDuty escalation / on-call routing (plans/34-pagerduty-escalation-oncall.md).
 *
 * Two independent PagerDuty credentials, deliberately kept separate:
 *
 *   - `HEALTH_ALERT_PAGERDUTY_API_KEY` — an account-level REST API token used
 *     ONLY to *list services* for the setup UI's picker
 *     ({@link listPagerDutyServices}). NEVER used to create/update/delete
 *     anything in PagerDuty — chmonitor pages humans, it does not manage
 *     PagerDuty configuration (services/escalation policies/schedules stay
 *     the operator's job in PagerDuty itself).
 *   - `HEALTH_ALERT_PAGERDUTY_ROUTING_KEY` — the legacy single-service
 *     Events API v2 integration/routing key, used as the fallback target
 *     when no per-rule/per-host PagerDuty route matches (or when D1 isn't
 *     configured) — see `resolvePagerDutyTargets` in `alert-routing.ts`.
 *
 * Fail-open guarantee: neither getter throws; an unset/blank env var simply
 * disables that capability (no services listed / no fallback routing key).
 */

import { debug } from '@chm/logger'

/** The fixed PagerDuty Events API v2 enqueue endpoint (same for every service). */
export const PAGERDUTY_EVENTS_API_URL =
  'https://events.pagerduty.com/v2/enqueue'

/** REST API token for read-only "list services" calls, or '' when unset. */
export function getPagerDutyRestApiKey(): string {
  return process.env.HEALTH_ALERT_PAGERDUTY_API_KEY?.trim() || ''
}

/** Legacy single-service routing key fallback, or '' when unset. */
export function getPagerDutyFallbackRoutingKey(): string {
  return process.env.HEALTH_ALERT_PAGERDUTY_ROUTING_KEY?.trim() || ''
}

/** One PagerDuty service, as surfaced to the setup UI's picker. */
export interface PagerDutyServiceOption {
  id: string
  name: string
}

interface PagerDutyServicesResponse {
  services?: Array<{ id?: unknown; name?: unknown }>
}

/**
 * List PagerDuty services via the REST API (read-only; `GET /services`).
 * Best-effort — returns `[]` on any error (no token configured, network
 * failure, non-2xx response, unexpected shape) rather than throwing, so a
 * PagerDuty API hiccup can never break the setup dialog. Never calls a
 * write/mutation PagerDuty endpoint.
 */
export async function listPagerDutyServices(
  apiKey = getPagerDutyRestApiKey()
): Promise<PagerDutyServiceOption[]> {
  if (!apiKey) return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch('https://api.pagerduty.com/services?limit=100', {
      method: 'GET',
      headers: {
        Authorization: `Token token=${apiKey}`,
        Accept: 'application/vnd.pagerduty+json;version=2',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      debug(`[pagerduty-config] list services returned status ${res.status}`)
      return []
    }
    const json = (await res.json()) as PagerDutyServicesResponse
    if (!Array.isArray(json.services)) return []
    return json.services
      .filter(
        (s): s is { id: string; name: string } =>
          typeof s.id === 'string' && typeof s.name === 'string'
      )
      .map((s) => ({ id: s.id, name: s.name }))
  } catch (err) {
    debug(
      '[pagerduty-config] list services failed',
      err instanceof Error ? err.message : String(err)
    )
    return []
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * HTTP transport for the sweep's alert dispatch (#2938).
 *
 * The two POST helpers every channel path ultimately funnels through. They own
 * transport only (timeout + non-OK handling + fail-open error text), so the
 * "which body shape does this URL get" decision stays pure and unit-testable in
 * `./../../adapters`.
 */

import type { PagerDutyEventBody } from './../../adapters'

import { PAGERDUTY_EVENTS_API_URL } from './../../pagerduty-config'
import { error } from '@chm/logger'

/** Result of a webhook delivery attempt, incl. the error text for the audit log. */
export interface WebhookResult {
  ok: boolean
  /** Present only when `ok` is false — recorded in the alert-history store. */
  error?: string
}

/**
 * POST a pre-built webhook body to the operator-configured URL. The body is
 * chosen per target by {@link buildWebhookDispatchBody} (Discord embeds, Slack
 * blocks, or the generic `{ text, content }` wrapper) — this function only owns
 * transport (timeout + non-OK handling), so the URL → shape decision stays pure
 * and unit-testable. Server-side, no CORS proxy needed.
 */
export async function postWebhook(
  url: string,
  body: unknown
): Promise<WebhookResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const message = `Webhook returned status ${res.status}`
      error('[health-sweep] Webhook returned non-OK status', new Error(message))
      return { ok: false, error: message }
    }
    return { ok: true }
  } catch (err) {
    error('[health-sweep] Webhook POST failed', err as Error)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * POST a PagerDuty Events API v2 body (`trigger` or `resolve`) to the fixed
 * enqueue endpoint, using a specific service's routing key — plan 34. Mirrors
 * {@link postWebhook}'s shape/timeout so the two dispatch paths behave the
 * same for the caller; only the content-type target differs (a real PagerDuty
 * body, not the generic `{ text, content }` wrapper).
 */
export async function postPagerDutyEvent(
  body: PagerDutyEventBody
): Promise<WebhookResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(PAGERDUTY_EVENTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const message = `PagerDuty Events API returned status ${res.status}`
      error(
        '[health-sweep] PagerDuty Events API returned non-OK status',
        new Error(message)
      )
      return { ok: false, error: message }
    }
    return { ok: true }
  } catch (err) {
    error('[health-sweep] PagerDuty Events API POST failed', err as Error)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

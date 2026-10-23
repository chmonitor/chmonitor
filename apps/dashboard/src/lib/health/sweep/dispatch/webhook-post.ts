/**
 * HTTP transport for the sweep's alert dispatch (#2938).
 *
 * The two POST helpers every channel path ultimately funnels through. They own
 * transport only (timeout + non-OK handling + fail-open error text), so the
 * "which body shape does this URL get" decision stays pure and unit-testable in
 * `./../../adapters`.
 */

import type { PagerDutyEventBody } from './../../adapters'
import type { WebhookTarget } from './../../alert-routing'

import { PAGERDUTY_EVENTS_API_URL } from './../../pagerduty-config'
import { debug, error } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

/** Result of a webhook delivery attempt, incl. the error text for the audit log. */
export interface WebhookResult {
  ok: boolean
  /** Present only when `ok` is false — recorded in the alert-history store. */
  error?: string
  /** The parsed JSON response, only when the caller asked for it and it parsed. */
  json?: unknown
}

/**
 * POST a pre-built webhook body to the operator-configured URL. The body is
 * chosen per target by {@link buildWebhookDispatchBody} (Discord embeds, Slack
 * blocks, or the generic `{ text, content }` wrapper) — this function only owns
 * transport (timeout + non-OK handling), so the URL → shape decision stays pure
 * and unit-testable. Server-side, no CORS proxy needed.
 *
 * `init.headers` carries caller-supplied extra headers (custom webhook targets'
 * sanitized `X-*` headers, feat #3414). `Content-Type: application/json` is
 * always set by the transport and cannot be overridden.
 */
export async function postWebhook(
  url: string,
  body: unknown,
  init?: {
    headers?: Record<string, string>
    /** Redirects are refused by default; a caller may opt in explicitly. */
    redirect?: RequestRedirect
    /** Parse the response body as JSON into `json` (best-effort). */
    readJson?: boolean
  }
): Promise<WebhookResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const serialized = JSON.stringify(body)
    if (new TextEncoder().encode(serialized).byteLength > 256 * 1024) {
      return { ok: false, error: 'Webhook payload exceeds the 256 KiB limit' }
    }
    const res = await fetch(url, {
      method: 'POST',
      // `Content-Type` is transport-owned and applied LAST so a caller header
      // can never override it (custom-target validation already rejects it,
      // this is defense-in-depth).
      headers: { ...(init?.headers ?? {}), 'Content-Type': 'application/json' },
      body: serialized,
      signal: controller.signal,
      redirect: init?.redirect ?? 'error',
    })
    if (!res.ok) {
      const message = `Webhook returned status ${res.status}`
      error('[health-sweep] Webhook returned non-OK status', new Error(message))
      return { ok: false, error: message }
    }
    if (init?.readJson) {
      try {
        return { ok: true, json: (await res.json()) as unknown }
      } catch {
        // A delivered message with an unreadable body is still delivered.
      }
    }
    return { ok: true }
  } catch {
    // Fetch errors can embed the full destination URL. Webhook URLs commonly
    // contain bearer credentials, so keep both logs and persisted audit rows
    // credential-safe instead of returning the raw exception message.
    error(
      '[health-sweep] Webhook POST failed',
      new Error('Webhook request failed')
    )
    return { ok: false, error: 'Webhook POST failed' }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * POST to a resolved webhook target. A target from a saved route is
 * re-checked against the SSRF guard right before sending (DNS can change
 * after save) and may not redirect; an operator-configured target (`trusted`)
 * is sent as is and may follow a redirect, as ntfy does, so an env URL behind
 * an http-to-https hop keeps delivering. A blocked target is never fetched and
 * its URL is never logged or returned.
 */
export async function postWebhookTarget(
  target: WebhookTarget,
  body: unknown
): Promise<WebhookResult> {
  if (target.trusted)
    return postWebhook(target.url, body, { redirect: 'follow' })
  if (await validateHostUrl(target.url)) {
    debug('[health-sweep] skipping webhook target: blocked destination')
    return { ok: false, error: 'Destination URL blocked' }
  }
  return postWebhook(target.url, body)
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

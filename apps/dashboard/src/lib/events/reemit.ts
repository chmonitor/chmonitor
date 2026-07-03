/**
 * Optional re-emit: forward a normalized inbound event to a configured
 * outbound webhook. OFF by default (no env var configured) — see
 * plans/36-inbound-event-bus-queues.md goal #5.
 *
 * SECURITY (SSRF): the configured URL is operator-supplied config (an env
 * var), not attacker-suppliable per-request input, but it is still run through
 * {@link validateHostUrl} — the same guard backing the health webhook proxy
 * (`/api/v1/health/webhook`) — before every fetch, so a misconfigured or
 * later-compromised env value can never reach a private/loopback/metadata
 * target. Never add a raw `fetch` to this URL that skips the guard.
 */

import type { NormalizedEvent } from './types'

import { warn } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

/** Injectable deps for tests (fetch + resolver, mirrors webhook.ts). */
export interface ReemitDeps {
  fetchImpl?: typeof fetch
  resolveHostAddresses?: Parameters<typeof validateHostUrl>[1]
}

/** Build the outbound JSON body forwarded to the re-emit webhook. */
export function buildReemitBody(event: NormalizedEvent): {
  text: string
  content: string
  event: NormalizedEvent
} {
  const heading =
    event.severity === 'info' ? 'RESOLVED' : event.severity.toUpperCase()
  const text = `[${heading}] ${event.title} — ${event.resource} (${event.source})`
  return { text, content: text, event }
}

/**
 * Forward `event` to `CHM_EVENTS_REEMIT_WEBHOOK_URL` when configured. Returns
 * false (and never throws) when re-emit is unconfigured, the URL fails the
 * SSRF guard, or the outbound fetch fails — re-emit is best-effort and must
 * never break ingest.
 */
export async function reemitEvent(
  event: NormalizedEvent,
  deps: ReemitDeps = {}
): Promise<boolean> {
  const url = process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL?.trim()
  if (!url) return false // off by default
  if (!url.startsWith('https://')) {
    warn(
      '[events/reemit] CHM_EVENTS_REEMIT_WEBHOOK_URL must be an https:// URL — skipping'
    )
    return false
  }

  const ssrfError = await validateHostUrl(url, deps.resolveHostAddresses)
  if (ssrfError) {
    warn(
      '[events/reemit] Blocked SSRF-unsafe re-emit URL',
      new Error(ssrfError)
    )
    return false
  }

  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReemitBody(event)),
      signal: controller.signal,
    })
    return res.ok
  } catch (err) {
    warn('[events/reemit] Re-emit fetch failed', err as Error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

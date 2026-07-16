/**
 * ntfy dispatch (transport layer).
 *
 * Builds the control headers + plain-text body with the pure formatter
 * (`adapters/ntfy.ts`) and POSTs them to the caller-supplied ntfy topic URL
 * (`<server>/<topic>`). This module is the only place that actually talks to
 * ntfy — mirrors the auth/transport separation Telegram/Opsgenie document (the
 * adapter stays network-free).
 *
 * Unlike Telegram (fixed `api.telegram.org` host), an ntfy topic URL is
 * OPERATOR-SUPPLIED (any self-hosted server), so it IS a caller-controlled
 * SSRF sink — the CRUD/test layers that accept such a URL from the browser
 * validate it with `validateHostUrl` (HTTPS-only, no private/loopback/metadata
 * targets) before it ever reaches here, exactly like the generic webhook path.
 * The env-configured global URL is operator-set and trusted.
 *
 * Never throws: a delivery failure must not abort the health sweep loop
 * (fail-open, matching `dispatchTelegram` / `postWebhook` / `dispatchOpsgenie`).
 */

import type { AlertPayload } from './adapters/types'
import type { ServerNtfyConfig } from './server-alert-config'

import { buildNtfyHeaders, buildNtfyMessage } from './adapters/ntfy'
import { error } from '@chm/logger'

/** Injectable dependencies (tests override fetch). */
export interface NtfyDispatchDeps {
  fetchImpl?: typeof fetch
}

/**
 * Dispatch one alert to an ntfy topic: renders the payload as headers + a
 * plain-text body and POSTs it to the topic URL. Returns whether the request
 * succeeded; never throws.
 */
export async function dispatchNtfy(
  payload: AlertPayload,
  config: ServerNtfyConfig,
  deps: NtfyDispatchDeps = {}
): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const { body } = buildNtfyMessage(payload)
    const res = await doFetch(config.url, {
      method: 'POST',
      headers: buildNtfyHeaders(payload, config.token),
      body,
      signal: controller.signal,
    })
    if (!res.ok) {
      error(
        '[health] ntfy dispatch returned non-OK status',
        new Error(`Status ${res.status}`)
      )
    }
    return res.ok
  } catch (err) {
    error('[health] ntfy dispatch failed', err as Error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

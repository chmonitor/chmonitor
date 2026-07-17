/**
 * Pushover dispatch (transport layer).
 *
 * Builds the JSON body with the pure formatter (`adapters/pushover.ts`) and
 * POSTs it to the fixed Pushover Messages API endpoint
 * (`https://api.pushover.net/1/messages.json`). This module is the only
 * place that actually talks to Pushover — mirrors the auth/transport
 * separation Telegram/ntfy document (the adapter stays network-free).
 *
 * The endpoint host is fixed — only `token`/`user` in the body vary — so
 * there is no caller-controlled SSRF sink here (unlike `webhook.ts` / the
 * ntfy topic URL, both of which fetch an arbitrary operator-supplied
 * destination). Same reasoning as `dispatchTelegram`.
 *
 * Never throws: a delivery failure must not abort the health sweep loop
 * (fail-open, matching `dispatchTelegram` / `dispatchNtfy` / `postWebhook`).
 */

import type { AlertPayload } from './adapters/types'
import type { ServerPushoverConfig } from './server-alert-config'

import { buildPushoverBody } from './adapters/pushover'
import { error } from '@chm/logger'

/** Fixed Pushover Messages API endpoint. */
export const PUSHOVER_MESSAGES_API_URL =
  'https://api.pushover.net/1/messages.json'

/** Injectable dependencies (tests override fetch). */
export interface PushoverDispatchDeps {
  fetchImpl?: typeof fetch
}

/**
 * Dispatch one alert to Pushover: renders the payload as a JSON body and
 * POSTs it to the Messages API. Returns whether the request succeeded;
 * never throws.
 */
export async function dispatchPushover(
  payload: AlertPayload,
  config: ServerPushoverConfig,
  deps: PushoverDispatchDeps = {}
): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const body = buildPushoverBody(payload, {
      token: config.token,
      user: config.user,
    })
    const res = await doFetch(PUSHOVER_MESSAGES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      error(
        '[health] Pushover dispatch returned non-OK status',
        new Error(`Status ${res.status}`)
      )
    }
    return res.ok
  } catch (err) {
    error('[health] Pushover dispatch failed', err as Error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Twilio SMS dispatch (transport layer).
 *
 * Builds the terse SMS body with the pure formatter (`adapters/twilio.ts`) and
 * POSTs it, once per configured recipient, to the Twilio Programmable
 * Messaging API (`https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`).
 *
 * Unlike every JSON-body sibling channel here (Telegram/ntfy/Opsgenie/
 * PagerDuty), Twilio's API is **form-encoded**
 * (`application/x-www-form-urlencoded`, fields `To`/`From`/`Body`) and
 * authenticates with **HTTP Basic auth** (`AccountSid:AuthToken`), never a
 * bearer token or API-key header — this module is the only place that shapes
 * that request.
 *
 * The endpoint host is fixed (`api.twilio.com`) — only the account SID in the
 * path varies — so there is no caller-controlled SSRF sink here, same
 * reasoning as `dispatchTelegram` (the account SID is a server-only env
 * value, never user input).
 *
 * Never throws: a delivery failure must not abort the health sweep loop
 * (fail-open, matching `dispatchTelegram` / `dispatchNtfy` / `dispatchOpsgenie`).
 */

import type { AlertPayload } from './adapters/types'
import type { ServerTwilioConfig } from './server-alert-config'

import { buildTwilioMessage } from './adapters/twilio'
import { error } from '@chm/logger'

/** Injectable dependencies (tests override fetch). */
export interface TwilioDispatchDeps {
  fetchImpl?: typeof fetch
}

/** Build the Programmable Messaging API URL for an Account SID. */
export function twilioMessagesUrl(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
}

/**
 * Build the `Authorization: Basic ...` header value for an Account SID + auth
 * token. `btoa` is available in every runtime this app ships to (Cloudflare
 * Workers, Node, browser) — same approach as `email-transport.ts` /
 * `peerdb-auth.ts`.
 */
export function twilioAuthHeader(
  accountSid: string,
  authToken: string
): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`
}

/**
 * Dispatch one alert as an SMS to every configured recipient (`config.to`) —
 * one POST per number, since the Messages API accepts only a single `To` per
 * request. Every recipient is attempted even if an earlier one fails; returns
 * true when at least one recipient received the message. Never throws.
 */
export async function dispatchTwilio(
  payload: AlertPayload,
  config: ServerTwilioConfig,
  deps: TwilioDispatchDeps = {}
): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch
  const url = twilioMessagesUrl(config.accountSid)
  const body = buildTwilioMessage(payload)
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: twilioAuthHeader(config.accountSid, config.authToken),
  }

  let anySuccess = false
  for (const to of config.to) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const form = new URLSearchParams({
        To: to,
        From: config.from,
        Body: body,
      })
      const res = await doFetch(url, {
        method: 'POST',
        headers,
        body: form.toString(),
        signal: controller.signal,
      })
      if (res.ok) {
        anySuccess = true
      } else {
        error(
          '[health] Twilio dispatch returned non-OK status',
          new Error(`Status ${res.status} for recipient ${to}`)
        )
      }
    } catch (err) {
      error('[health] Twilio dispatch failed', err as Error)
    } finally {
      clearTimeout(timeout)
    }
  }
  return anySuccess
}

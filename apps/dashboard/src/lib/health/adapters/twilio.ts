/**
 * Twilio SMS notification adapter (pure formatter).
 *
 * Builds the terse plain-text body sent as the `Body` parameter of a Twilio
 * Programmable Messaging API "Send a Message" request
 * (`POST https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`).
 *
 * SMS is a last-resort paging channel (#2668): it costs real money per
 * message and the Messages API rejects any `Body` over
 * {@link TWILIO_SMS_MAX_LENGTH} characters, so the message is deliberately
 * terser than every other channel's format and is truncated defensively
 * before it is ever sent.
 *
 * Auth (`Authorization: Basic <base64(AccountSid:AuthToken)>`), the
 * form-encoded request shape, and the per-recipient fan-out are applied by
 * the dispatch layer (`../twilio-dispatch.ts`), not this pure builder —
 * mirrors `telegram.ts` / `opsgenie.ts`.
 */

import type { AlertPayload, NotificationAdapter } from './types'

/** Twilio's hard per-message character limit for the `Body` parameter. */
export const TWILIO_SMS_MAX_LENGTH = 1600

/** Character appended when a message is truncated to fit the SMS limit. */
const TRUNCATION_MARKER = '…'

/**
 * Truncate `text` to at most `maxLength` characters, replacing the tail with
 * {@link TRUNCATION_MARKER} when it would otherwise overflow. A no-op when
 * `text` already fits. Exported so the dispatch layer / tests can assert the
 * limit independent of the message content.
 */
export function truncateSmsBody(
  text: string,
  maxLength: number = TWILIO_SMS_MAX_LENGTH
): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
}

/** `RECOVERY` for a resolved incident, otherwise the uppercased severity. */
function heading(severity: AlertPayload['severity']): string {
  return severity === 'recovery' ? 'RECOVERY' : severity.toUpperCase()
}

/**
 * Build the SMS body for a payload: `[SEVERITY] title on host: label`,
 * truncated to {@link TWILIO_SMS_MAX_LENGTH} characters. Deliberately terse —
 * unlike the multi-line formats used by chat/push channels — since every
 * character is billed and the hard cap leaves no room for a full breakdown.
 */
export function buildTwilioMessage(payload: AlertPayload): string {
  const text = `[${heading(payload.severity)}] ${payload.title} on ${payload.hostLabel}: ${payload.label}`
  return truncateSmsBody(text)
}

/**
 * Twilio adapter. `buildBody` returns the SMS body text only — Twilio's
 * `To`/`From` fields and Basic-auth header are applied by the dispatch layer,
 * not this builder. Deliberately NOT registered in `ADAPTERS` (see
 * `adapters/index.ts`): Twilio is selected by env config only (no routing UI —
 * credentials are too sensitive, see #2668), and its Basic-auth,
 * form-encoded transport can't ride the generic `{ text, content }` proxy
 * path any of the JSON webhook channels use.
 */
export const twilioAdapter: NotificationAdapter = {
  id: 'twilio',
  buildBody: (payload: AlertPayload) => buildTwilioMessage(payload),
}

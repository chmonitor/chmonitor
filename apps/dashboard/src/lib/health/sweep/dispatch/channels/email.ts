/**
 * Email alert dispatch (plan 25), extracted verbatim in #2938.
 */

import type { EmailConfig } from './../../../adapters/email'
import type { FindingContext } from './../finding-context'

import { buildEmailBody } from './../../../adapters'
import { sendAlertEmail } from './../../../email-transport'
import { recordChannelEvent } from './../alert-event-record'
import { buildChannelPayload } from './../finding-context'

/**
 * Email: a single global env-configured destination, same shape as Opsgenie —
 * no per-route resolution yet. The caller fires this whenever `emailConfig` is
 * set and the channel gate passes, independent of every other channel.
 * `sendAlertEmail` never throws (fails open): Mailgun/SendGrid send for real
 * over authenticated HTTPS; the `smtp` provider is not implemented yet
 * (Cloudflare Workers has no raw TCP) and always resolves `false` with its own
 * log line — never a silent fake "sent".
 */
export async function dispatchEmailChannel(
  finding: FindingContext,
  emailConfig: EmailConfig
): Promise<boolean> {
  const emailBody = buildEmailBody(buildChannelPayload(finding))
  const ok = await sendAlertEmail(emailConfig, emailBody)

  await recordChannelEvent(finding, {
    delivered: ok,
    error: ok ? undefined : 'Email dispatch failed',
    channel: 'email',
  })

  return ok
}

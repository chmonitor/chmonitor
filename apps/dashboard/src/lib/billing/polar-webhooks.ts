/**
 * Polar webhook verification without `@polar-sh/sdk/webhooks`.
 *
 * Polar uses the Standard Webhooks signing scheme. The SDK base64-encodes the
 * configured secret before verifying — we do the same, then return the parsed
 * JSON payload. Callers only need `type` / `data` / `timestamp` and already
 * cast `data` to their own shapes, so we skip the Speakeasy zod event tree
 * (the bulk of the SDK webhook module).
 */

import {
  WebhookVerificationError as SwWebhookError,
  Webhook,
} from 'standardwebhooks'

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

export interface PolarWebhookEvent {
  type: string
  data: unknown
  timestamp?: string | Date
  [key: string]: unknown
}

/**
 * Verify Polar webhook signature and parse the JSON body.
 *
 * @param body raw request body string (must match the signed bytes)
 * @param headers request headers (lowercase keys preferred; Standard Webhooks
 *                looks up `webhook-id` / `webhook-timestamp` / `webhook-signature`)
 * @param secret POLAR_WEBHOOK_SECRET as configured in the Polar dashboard
 */
export function validateEvent(
  body: string,
  headers: Record<string, string>,
  secret: string
): PolarWebhookEvent {
  // Match @polar-sh/sdk/webhooks: secret is utf-8 then base64 for Standard Webhooks.
  const base64Secret =
    typeof Buffer !== 'undefined'
      ? Buffer.from(secret, 'utf-8').toString('base64')
      : btoa(secret)

  // Standard Webhooks header lookup is case-sensitive on some versions —
  // normalize to lowercase keys.
  const normalized: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v
  }

  const webhook = new Webhook(base64Secret)
  try {
    const parsed = webhook.verify(body, normalized) as PolarWebhookEvent
    return parsed
  } catch (err) {
    if (err instanceof SwWebhookError) {
      throw new WebhookVerificationError(err.message)
    }
    throw err
  }
}

/**
 * Shared inbound-request verification for the Slack routes (plans/37).
 *
 * Every inbound Slack request (slash commands, interactivity, events) is signed
 * with the app signing secret. This helper centralizes the security-critical
 * sequence used by all three routes:
 *
 *   1. Bail if the Slack app is not configured (feature off → caller 501s).
 *   2. Read the RAW body ONCE (`request.text()`) — the signature is computed
 *      over the raw bytes, so this MUST happen before any formData()/json()
 *      parse (which would consume the stream and break verification).
 *   3. Verify the `X-Slack-Signature` + `X-Slack-Request-Timestamp` headers
 *      against the raw body (HMAC + freshness).
 *
 * Returns the raw body so the caller can parse it (URLSearchParams / JSON) only
 * AFTER verification succeeds.
 */

import { getSlackSigningSecret, isSlackAppConfigured } from './config'
import { verifySlackRequest } from './verify-signature'

export interface InboundVerification {
  /** Whether the Slack app is configured at all (false → caller returns 501). */
  configured: boolean
  /** Whether the signature + timestamp verified (false → caller returns 401). */
  verified: boolean
  /** The raw request body (empty string when unconfigured). */
  rawBody: string
}

export async function readAndVerifySlackRequest(
  request: Request
): Promise<InboundVerification> {
  if (!isSlackAppConfigured()) {
    return { configured: false, verified: false, rawBody: '' }
  }
  const signingSecret = getSlackSigningSecret()
  if (!signingSecret) {
    return { configured: false, verified: false, rawBody: '' }
  }

  const rawBody = await request.text()
  const verified = await verifySlackRequest({
    signingSecret,
    signature: request.headers.get('x-slack-signature'),
    timestamp: request.headers.get('x-slack-request-timestamp'),
    rawBody,
  })

  return { configured: true, verified, rawBody }
}

/**
 * Email dispatch (transport) layer — the ONLY place that knows the provider
 * secret and actually sends over the network. `buildEmailBody` (the pure
 * adapter) never touches this file's imports; this module is the caller that
 * applies transport to a body already built by the adapter.
 *
 * Outbound requests go ONLY to the fixed, hardcoded provider API endpoint
 * (Mailgun / SendGrid); recipients/from/provider come from server env
 * (`getServerEmailConfig` / `HEALTH_ALERT_EMAIL_PROVIDER_URL`), never from a
 * user-controlled URL — there is no SSRF surface here (contrast with
 * `/api/v1/health/webhook`, which does proxy a caller-supplied URL).
 *
 * `sendAlertEmail` never throws — every failure is caught and logged so a
 * misconfigured or unreachable provider cannot break the health sweep.
 */

import type { EmailBody, EmailConfig } from './adapters/email'

import { debug, error } from '@chm/logger'

const SEND_TIMEOUT_MS = 10_000

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

/** Extract `{ apiKey, domain }` from `mailgun://KEY@DOMAIN`. */
function parseMailgunUrl(
  url: string
): { apiKey: string; domain: string } | null {
  const match = /^mailgun:\/\/([^@]+)@(.+)$/i.exec(url.trim())
  if (!match) return null
  const apiKey = match[1]
  const domain = match[2]
  if (!apiKey || !domain) return null
  return { apiKey, domain }
}

/** Extract `{ apiKey }` from `sendgrid://KEY`. */
function parseSendGridUrl(url: string): { apiKey: string } | null {
  const match = /^sendgrid:\/\/(.+)$/i.exec(url.trim())
  const apiKey = match?.[1]
  return apiKey ? { apiKey } : null
}

async function sendViaMailgun(
  config: EmailConfig,
  body: EmailBody,
  providerUrl: string
): Promise<boolean> {
  const parsed = parseMailgunUrl(providerUrl)
  if (!parsed) {
    error(
      '[health-email] HEALTH_ALERT_EMAIL_PROVIDER_URL is not a valid mailgun://KEY@DOMAIN url',
      new Error('invalid mailgun provider url')
    )
    return false
  }

  const form = new URLSearchParams()
  form.set('from', config.from)
  for (const to of config.to) form.append('to', to)
  form.set('subject', body.subject)
  form.set('html', body.html)
  form.set('text', body.text)

  const { signal, clear } = withTimeout()
  try {
    const res = await fetch(
      `https://api.mailgun.net/v3/${parsed.domain}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`api:${parsed.apiKey}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal,
      }
    )
    if (!res.ok) {
      error(
        '[health-email] Mailgun send returned non-OK status',
        new Error(`Status ${res.status}`)
      )
    }
    return res.ok
  } catch (err) {
    error('[health-email] Mailgun send failed', err)
    return false
  } finally {
    clear()
  }
}

async function sendViaSendGrid(
  config: EmailConfig,
  body: EmailBody,
  providerUrl: string
): Promise<boolean> {
  const parsed = parseSendGridUrl(providerUrl)
  if (!parsed) {
    error(
      '[health-email] HEALTH_ALERT_EMAIL_PROVIDER_URL is not a valid sendgrid://KEY url',
      new Error('invalid sendgrid provider url')
    )
    return false
  }

  const payload = {
    personalizations: [{ to: config.to.map((email) => ({ email })) }],
    from: { email: config.from },
    subject: body.subject,
    content: [
      { type: 'text/plain', value: body.text },
      { type: 'text/html', value: body.html },
    ],
  }

  const { signal, clear } = withTimeout()
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parsed.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      error(
        '[health-email] SendGrid send returned non-OK status',
        new Error(`Status ${res.status}`),
        { text }
      )
    }
    return res.ok
  } catch (err) {
    error('[health-email] SendGrid send failed', err)
    return false
  } finally {
    clear()
  }
}

/**
 * SMTP transport is NOT implemented: this app runs primarily on Cloudflare
 * Workers (`nodejs_compat` does not provide reliable raw TCP sockets there),
 * there is no mail-sending dependency in the repo, and hand-rolling a
 * SMTP/STARTTLS client would be unreliable on the primary deploy target.
 * Config/detection for `smtp://` / `smtps://` is fully supported (see
 * `detectEmailProvider`) so operators can select it, but sending fails
 * gracefully with a clear log until a real SMTP transport lands.
 */
function sendViaSmtp(): Promise<boolean> {
  error(
    '[health-email] SMTP transport is not implemented yet — configure HEALTH_ALERT_EMAIL_PROVIDER_URL with mailgun:// or sendgrid:// to send real alert emails',
    new Error('smtp transport not implemented')
  )
  return Promise.resolve(false)
}

/**
 * Send a pre-built alert email via the provider selected by
 * `config.provider` (from {@link getServerEmailConfig}). Reads the transport
 * secret directly from `HEALTH_ALERT_EMAIL_PROVIDER_URL` — never threaded
 * through the pure {@link EmailConfig} — and never throws: every failure path
 * is caught and logged, returning `false` so a misconfigured or unreachable
 * provider cannot break the health sweep.
 */
export async function sendAlertEmail(
  config: EmailConfig,
  body: EmailBody
): Promise<boolean> {
  try {
    const providerUrl =
      process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL?.trim() || ''
    if (!providerUrl) {
      error(
        '[health-email] sendAlertEmail called without HEALTH_ALERT_EMAIL_PROVIDER_URL',
        new Error('missing provider url')
      )
      return false
    }

    debug('[health-email] Sending alert email', {
      provider: config.provider,
      to: config.to.length,
    })

    switch (config.provider) {
      case 'mailgun':
        return await sendViaMailgun(config, body, providerUrl)
      case 'sendgrid':
        return await sendViaSendGrid(config, body, providerUrl)
      case 'smtp':
        return await sendViaSmtp()
      default:
        return false
    }
  } catch (err) {
    error('[health-email] sendAlertEmail failed unexpectedly', err)
    return false
  }
}

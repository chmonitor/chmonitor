/**
 * Email notification adapter (pure formatter).
 *
 * Renders a clean HTML + plaintext alert email (host, check, value,
 * thresholds, runbook links). The provider (Mailgun / SendGrid / SMTP) is
 * detected from a config URL scheme; the actual transport (API key, SMTP
 * credentials, sending) is applied by the dispatch layer — this module only
 * shapes `{ subject, html, text }` from an {@link AlertPayload}.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Supported email transport providers. */
export type EmailProvider = 'mailgun' | 'sendgrid' | 'smtp'

/** Caller-supplied email transport config (secrets resolved by the dispatch layer). */
export interface EmailConfig {
  provider: EmailProvider
  from: string
  to: readonly string[]
}

/** PURE: normalized email parts for a payload. No network. */
export interface EmailBody {
  /** e.g. `[CRITICAL] failed-mutations on prod-01`. */
  subject: string
  /** Rendered HTML alert (inline styles only — email clients strip `<style>`). */
  html: string
  /** Plaintext mirror for the multipart alternative. */
  text: string
}

/** Severity → banner colour and subject/heading label. `recovery` reads "RESOLVED". */
const SEVERITY_STYLE: Record<
  AlertSeverity,
  { color: string; heading: string }
> = {
  critical: { color: '#dc2626', heading: 'CRITICAL' },
  warning: { color: '#f59e0b', heading: 'WARNING' },
  recovery: { color: '#16a34a', heading: 'RESOLVED' },
}

/**
 * HTML-encode a string for use in both element text content and a
 * double-quoted attribute value. Escaping all five reserved characters keeps
 * a single helper safe for both contexts, as long as attributes are always
 * double-quoted (which every attribute below is).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only `http(s)` runbook URLs render as clickable links; anything else (e.g. `javascript:`) renders as inert escaped text. */
function isSafeLinkUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function thresholdText(payload: AlertPayload): string {
  const parts: string[] = []
  if (payload.warnThreshold !== undefined && payload.warnThreshold !== null) {
    parts.push(`warn ${payload.warnThreshold}`)
  }
  if (payload.critThreshold !== undefined && payload.critThreshold !== null) {
    parts.push(`crit ${payload.critThreshold}`)
  }
  return parts.length > 0 ? parts.join(' | ') : '—'
}

function valueText(payload: AlertPayload): string {
  return payload.value === null ? 'n/a' : String(payload.value)
}

/** Build the HTML alert body: a coloured banner + a simple info table. */
function buildHtml(payload: AlertPayload): string {
  const style = SEVERITY_STYLE[payload.severity]
  const rows: string[] = [
    `<tr><td style="color:#6b7280;padding:6px 8px;">Host</td><td style="padding:6px 8px;">${escapeHtml(payload.hostLabel)} (id ${payload.hostId})</td></tr>`,
    `<tr><td style="color:#6b7280;padding:6px 8px;">Metric</td><td style="padding:6px 8px;">${escapeHtml(payload.metric)}</td></tr>`,
    `<tr><td style="color:#6b7280;padding:6px 8px;">Value</td><td style="padding:6px 8px;">${escapeHtml(valueText(payload))}</td></tr>`,
    `<tr><td style="color:#6b7280;padding:6px 8px;">Thresholds</td><td style="padding:6px 8px;">${escapeHtml(thresholdText(payload))}</td></tr>`,
    `<tr><td style="color:#6b7280;padding:6px 8px;">Detail</td><td style="padding:6px 8px;">${escapeHtml(payload.label)}</td></tr>`,
  ]

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    const links = payload.runbookUrls
      .map((url) => {
        const safeText = escapeHtml(url)
        return isSafeLinkUrl(url)
          ? `<a href="${safeText}" style="color:#2563eb;">${safeText}</a>`
          : safeText
      })
      .join('<br />')
    rows.push(
      `<tr><td style="color:#6b7280;padding:6px 8px;">Runbooks</td><td style="padding:6px 8px;">${links}</td></tr>`
    )
  }

  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#111827;max-width:480px;">',
    `<div style="background:${style.color};color:#ffffff;padding:12px 16px;border-radius:6px 6px 0 0;font-size:16px;font-weight:600;">${style.heading}: ${escapeHtml(payload.title)}</div>`,
    `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-top:none;font-size:14px;">${rows.join('')}</table>`,
    `<div style="color:#9ca3af;font-size:12px;margin-top:8px;">${escapeHtml(payload.timestamp)}</div>`,
    '</div>',
  ].join('')
}

/** Build the plaintext mirror of the HTML body. */
function buildText(payload: AlertPayload): string {
  const style = SEVERITY_STYLE[payload.severity]
  const lines: string[] = [
    `${style.heading}: ${payload.title}`,
    '',
    `Host: ${payload.hostLabel} (id ${payload.hostId})`,
    `Metric: ${payload.metric}`,
    `Value: ${valueText(payload)}`,
    `Thresholds: ${thresholdText(payload)}`,
    `Detail: ${payload.label}`,
  ]

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    lines.push('', 'Runbooks:')
    for (const url of payload.runbookUrls) {
      lines.push(`- ${url}`)
    }
  }

  lines.push('', payload.timestamp)

  return lines.join('\n')
}

/**
 * Build the email `{ subject, html, text }` for a payload. PURE — no network,
 * no provider secrets. `subject` uses the uppercase severity heading, except
 * `recovery` which reads "RESOLVED" (rather than "RECOVERY", to read naturally
 * as an email subject line).
 */
export function buildEmailBody(payload: AlertPayload): EmailBody {
  const style = SEVERITY_STYLE[payload.severity]
  return {
    subject: `[${style.heading}] ${payload.metric} on ${payload.hostLabel}`,
    html: buildHtml(payload),
    text: buildText(payload),
  }
}

/**
 * Detect the email provider from a config URL scheme:
 * `mailgun://`, `sendgrid://`, `smtp://`, or `smtps://`. Returns `null` for
 * anything else (including `http(s)://` webhook URLs) so this never hijacks
 * webhook routing.
 */
export function detectEmailProvider(url: string): EmailProvider | null {
  const match = /^(mailgun|sendgrid|smtps?):\/\//i.exec(url.trim())
  if (!match) return null
  const scheme = match[1]?.toLowerCase()
  if (scheme === 'mailgun') return 'mailgun'
  if (scheme === 'sendgrid') return 'sendgrid'
  if (scheme === 'smtp' || scheme === 'smtps') return 'smtp'
  return null
}

/**
 * Email adapter. `detect` only matches provider config URL schemes (never
 * `http(s)`), so registering it never changes `detectAdapter`'s routing for
 * existing webhook URLs.
 */
export const emailAdapter: NotificationAdapter = {
  id: 'email',
  detect: (url: string) => detectEmailProvider(url) !== null,
  buildBody: (payload: AlertPayload) => buildEmailBody(payload),
}

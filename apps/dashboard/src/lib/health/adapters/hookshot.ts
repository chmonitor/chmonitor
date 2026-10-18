/**
 * matrix-hookshot generic-webhook adapter (pure formatter).
 *
 * Hookshot's inbound generic webhook reads exactly three keys: `text`
 * (Markdown, required fallback), `html` (used verbatim as `formatted_body`),
 * and `username` (prepended to the message). A body without `text` is dumped
 * into the room as raw JSON — which is what the `matrix` (`m.notice`) shape
 * produces, so Hookshot needs its own format.
 *
 * All operator-controlled text is HTML-escaped in `html`; `text` is plain so a
 * value containing Markdown syntax cannot restyle the fallback in a way that
 * hides content.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

import { identityLine, instancePrefix } from './identity'
import {
  colorHtml,
  escapeMatrixHtml,
  identityHtml,
  renderMatrixDigest,
} from './matrix'

export interface HookshotWebhookBody {
  /** Markdown/plain fallback; Hookshot requires it. */
  text: string
  /** HTML body rendered by Matrix clients. */
  html: string
  /** Optional sender label Hookshot prepends to the message. */
  username?: string
}

const SEVERITY_STYLE: Record<AlertSeverity, { emoji: string; label: string }> =
  {
    critical: { emoji: '🔴', label: 'CRITICAL' },
    warning: { emoji: '🟠', label: 'WARNING' },
    recovery: { emoji: '🟢', label: 'RESOLVED' },
  }

/** Build the Hookshot body for a payload. Pure — no transport. */
export function buildHookshotBody(payload: AlertPayload): HookshotWebhookBody {
  const style = SEVERITY_STYLE[payload.severity]
  const value = payload.value === null ? 'n/a' : String(payload.value)
  const identity = identityLine(payload)
  const text =
    `${instancePrefix(payload)}${style.emoji} [${style.label}] ${payload.title} — ${payload.label}\n` +
    `host ${payload.hostLabel} · ${payload.metric} = ${value} · ${payload.timestamp}` +
    (identity ? `\n${identity}` : '') +
    (payload.dashboardUrl ? `\n${payload.dashboardUrl}` : '')
  const html =
    `<b>${colorHtml(payload.severity, `${escapeMatrixHtml(instancePrefix(payload))}${style.emoji} [${style.label}] ${escapeMatrixHtml(payload.title)}`)}</b><br>` +
    `${escapeMatrixHtml(payload.label)}<br>` +
    `<i>host ${escapeMatrixHtml(payload.hostLabel)} · ` +
    `${escapeMatrixHtml(payload.metric)} = ${escapeMatrixHtml(value)} · ` +
    `${escapeMatrixHtml(payload.timestamp)}</i>` +
    identityHtml(payload, identity)
  return payload.instanceName
    ? { text, html, username: payload.instanceName }
    : { text, html }
}

/**
 * Hookshot body for ≥2 findings bound for one target (#3869): one grouped
 * message instead of N. Shares the Matrix digest renderer. Pure.
 */
export function buildHookshotDigestBody(
  payloads: readonly AlertPayload[]
): HookshotWebhookBody {
  const { text, html } = renderMatrixDigest(payloads)
  const instanceName = payloads[0]?.instanceName
  return instanceName ? { text, html, username: instanceName } : { text, html }
}

/** Selected explicitly via `format: 'hookshot'`; Hookshot URLs are self-hosted, so no `detect`. */
export const hookshotAdapter: NotificationAdapter = {
  id: 'hookshot',
  buildBody: (payload: AlertPayload) => buildHookshotBody(payload),
}

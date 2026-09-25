/**
 * Matrix / Element notification adapter (pure formatter, feat #3414).
 *
 * Builds a Matrix `m.room.message` event with `msgtype: m.notice` — the shape
 * an Element (or matrix-appservice-webhook style) receiver renders as a plain
 * notice. Both the plain-text `body` (required fallback) and an HTML
 * `formatted_body` are emitted; all operator-controlled text is HTML-escaped so
 * a custom title/body template can never inject markup.
 *
 * This adapter is intentionally NOT registered in `ADAPTERS`' URL-detection
 * list: there is no canonical Matrix webhook URL pattern, so auto-detection
 * would risk re-routing existing generic-JSON targets. Matrix bodies are only
 * produced when a custom webhook target explicitly selects the `matrix` format
 * (see `custom-webhook-targets.ts`) — existing auto-detected behavior is
 * byte-identical.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Matrix `m.room.message` event carrying an `m.notice`. */
export interface MatrixMessageBody {
  msgtype: 'm.notice'
  /** Plain-text fallback — always present, always unformatted. */
  body: string
  /** Declares that `formatted_body` is HTML. */
  format: 'org.matrix.custom.html'
  /** HTML rendering of the same notice (escaped, minimal markup). */
  formatted_body: string
}

const SEVERITY_STYLE: Record<AlertSeverity, { emoji: string; label: string }> =
  {
    critical: { emoji: '🔴', label: 'CRITICAL' },
    warning: { emoji: '🟠', label: 'WARNING' },
    recovery: { emoji: '🟢', label: 'RECOVERY' },
  }

/** HTML-escape operator-controlled text for `formatted_body`. */
export function escapeMatrixHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Build the Matrix `m.notice` body for a payload. Pure — no transport.
 */
export function buildMatrixBody(payload: AlertPayload): MatrixMessageBody {
  const style = SEVERITY_STYLE[payload.severity]
  const value = payload.value === null ? 'n/a' : String(payload.value)
  const body =
    `${style.emoji} [${style.label}] ${payload.title} — ${payload.label} ` +
    `(host ${payload.hostLabel}, ${payload.metric} = ${value})`
  const formatted_body =
    `<b>${style.emoji} [${style.label}] ${escapeMatrixHtml(payload.title)}</b><br>` +
    `${escapeMatrixHtml(payload.label)}<br>` +
    `<i>host ${escapeMatrixHtml(payload.hostLabel)} · ` +
    `${escapeMatrixHtml(payload.metric)} = ${escapeMatrixHtml(value)} · ` +
    `${escapeMatrixHtml(payload.timestamp)}</i>`
  return {
    msgtype: 'm.notice',
    body,
    format: 'org.matrix.custom.html',
    formatted_body,
  }
}

/**
 * Matrix adapter. Has no `detect` — it is selected explicitly via a custom
 * webhook target's `format: 'matrix'`, never by URL sniffing (see above).
 */
export const matrixAdapter: NotificationAdapter = {
  id: 'matrix',
  buildBody: (payload: AlertPayload) => buildMatrixBody(payload),
}

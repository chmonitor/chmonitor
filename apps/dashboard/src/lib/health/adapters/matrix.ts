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

import {
  firedForLine,
  incidentLine,
  MAX_DIGEST_LINES,
  stillOpenLine,
  summarizeDigest,
} from './digest'
import { thresholdParts } from './facts'
import { digestDashboardUrl, identityLine, instancePrefix } from './identity'

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
    recovery: { emoji: '🟢', label: 'RESOLVED' },
  }

/** HTML-escape operator-controlled text for `formatted_body`. */
export function escapeMatrixHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Matrix `data-mx-color` per severity (critical red, warning orange, recovery green). */
export const MATRIX_SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#dd3333',
  warning: '#ff8c00',
  recovery: '#2e9e44',
}

/** Wrap already-escaped HTML in a Matrix colour tag for the severity. */
export function colorHtml(severity: AlertSeverity, html: string): string {
  return `<font data-mx-color="${MATRIX_SEVERITY_COLOR[severity]}">${html}</font>`
}

/**
 * Shared Matrix/Hookshot digest renderer (#3869): a coloured summary header,
 * findings grouped by rule (bold rule name + list of host / metric = value /
 * severity), an "…and N more" line past {@link MAX_DIGEST_LINES}, and ONE
 * dashboard link at the end. `html` escapes every operator-controlled string;
 * `text` is the plain-text mirror.
 */
export function renderMatrixDigest(payloads: readonly AlertPayload[]): {
  text: string
  html: string
} {
  const summary = summarizeDigest(payloads)
  const top = SEVERITY_STYLE[summary.topSeverity]
  const heading = `${top.emoji} ${summary.summaryLine}`

  const groups = new Map<string, AlertPayload[]>()
  for (const p of payloads.slice(0, MAX_DIGEST_LINES)) {
    const list = groups.get(p.title)
    if (list) list.push(p)
    else groups.set(p.title, [p])
  }

  const textLines = [heading]
  let html = `<b>${colorHtml(summary.topSeverity, escapeMatrixHtml(heading))}</b>`
  for (const [title, list] of groups) {
    textLines.push('', title)
    html += `<br><b>${escapeMatrixHtml(title)}</b><ul>`
    for (const p of list) {
      const style = SEVERITY_STYLE[p.severity]
      if (p.stillOpenMs !== undefined) {
        const open = stillOpenLine(p)
        textLines.push(`- ${style.emoji} ${p.hostLabel} · ${open}`)
        html += `<li>${style.emoji} ${escapeMatrixHtml(p.hostLabel)} · ${escapeMatrixHtml(open)}</li>`
        continue
      }
      const value = p.value === null ? 'n/a' : String(p.value)
      const line = `${p.hostLabel} · ${p.metric} = ${value} · ${style.label}`
      const firedFor = firedForLine(p)
      const detail = firedFor ? `${p.label}, ${firedFor}` : p.label
      textLines.push(`- ${style.emoji} ${line} — ${detail}`)
      html +=
        `<li>${style.emoji} ${escapeMatrixHtml(p.hostLabel)} · ` +
        `${escapeMatrixHtml(p.metric)} = ${escapeMatrixHtml(value)} · ` +
        `${colorHtml(p.severity, style.label)} — ${escapeMatrixHtml(detail)}</li>`
    }
    html += '</ul>'
  }
  if (summary.overflow > 0) {
    textLines.push(`…and ${summary.overflow} more`)
    html += `<i>…and ${summary.overflow} more</i>`
  }
  const link = digestDashboardUrl(payloads)
  if (link) {
    textLines.push(link)
    html += `<br><a href="${escapeMatrixHtml(link)}">Open dashboard</a>`
  }
  return { text: textLines.join('\n'), html }
}

/**
 * The facts the one-line Matrix/Hookshot summary cannot hold: thresholds, the
 * incident timeline (still open / fired for) and runbook links. `text` is one
 * entry per line (plain), `html` the escaped `<br>`-joined mirror; both are
 * empty when the payload has none of them.
 */
export function factsBlock(payload: AlertPayload): {
  text: string[]
  html: string
} {
  const text: string[] = []
  let html = ''
  const thresholds = thresholdParts(payload)
  if (thresholds.length > 0) {
    const line = `thresholds ${thresholds.join(' | ')}`
    text.push(line)
    html += `<br>${escapeMatrixHtml(line)}`
  }
  const incident = incidentLine(payload)
  if (incident) {
    text.push(incident)
    html += `<br>${escapeMatrixHtml(incident)}`
  }
  const urls = payload.runbookUrls ?? []
  if (urls.length > 0) {
    text.push('runbooks:', ...urls.map((u) => `- ${u}`))
    html +=
      '<br>runbooks:<ul>' +
      urls
        .map(
          (u) =>
            `<li><a href="${escapeMatrixHtml(u)}">${escapeMatrixHtml(u)}</a></li>`
        )
        .join('') +
      '</ul>'
  }
  return { text, html }
}

/**
 * HTML tail shared by the Matrix and Hookshot bodies: the escaped identity
 * line and an "Open dashboard" link. '' when neither is configured.
 */
export function identityHtml(payload: AlertPayload, identity: string): string {
  let html = ''
  if (identity) html += `<br><small>${escapeMatrixHtml(identity)}</small>`
  if (payload.dashboardUrl) {
    html += `<br><a href="${escapeMatrixHtml(payload.dashboardUrl)}">Open dashboard</a>`
  }
  return html
}

/**
 * Build the Matrix `m.notice` body for a payload. Pure — no transport.
 */
export function buildMatrixBody(payload: AlertPayload): MatrixMessageBody {
  const style = SEVERITY_STYLE[payload.severity]
  const value = payload.value === null ? 'n/a' : String(payload.value)
  const identity = identityLine(payload)
  const facts = factsBlock(payload)
  const body =
    `${instancePrefix(payload)}${style.emoji} [${style.label}] ${payload.title} — ${payload.label} ` +
    `(host ${payload.hostLabel}, ${payload.metric} = ${value})` +
    facts.text.map((line) => `\n${line}`).join('') +
    (identity ? `\n${identity}` : '') +
    (payload.dashboardUrl ? `\n${payload.dashboardUrl}` : '')
  const formatted_body =
    `<b>${colorHtml(payload.severity, `${escapeMatrixHtml(instancePrefix(payload))}${style.emoji} [${style.label}] ${escapeMatrixHtml(payload.title)}`)}</b><br>` +
    `${escapeMatrixHtml(payload.label)}<br>` +
    `<i>host ${escapeMatrixHtml(payload.hostLabel)} · ` +
    `${escapeMatrixHtml(payload.metric)} = ${escapeMatrixHtml(value)} · ` +
    `${escapeMatrixHtml(payload.timestamp)}</i>` +
    facts.html +
    identityHtml(payload, identity)
  return {
    msgtype: 'm.notice',
    body,
    format: 'org.matrix.custom.html',
    formatted_body,
  }
}

/** Matrix `m.notice` digest for ≥2 findings bound for one target. Pure. */
export function buildMatrixDigestBody(
  payloads: readonly AlertPayload[]
): MatrixMessageBody {
  const { text, html } = renderMatrixDigest(payloads)
  return {
    msgtype: 'm.notice',
    body: text,
    format: 'org.matrix.custom.html',
    formatted_body: html,
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

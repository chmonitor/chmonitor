/**
 * Customizable alert webhook targets (feat #3414) — PURE layer.
 *
 * A custom target is an operator-defined fan-out destination for health alerts:
 * a name, an HTTPS URL, an explicit output format, an optional severity floor,
 * optional `{{variable}}` title/body templates, and optional `X-*` custom
 * headers. Unlike the single legacy global webhook (auto-detected adapter,
 * `{ text, content }` wrapper), each custom target declares exactly which body
 * shape it receives:
 *
 *   - `auto`     — today's URL detection (`detectAdapter`), backward compatible
 *   - `raw-json` — the normalized generic-JSON body (`buildGenericJsonBody`)
 *   - `slack`    — the Block-Kit body (`buildSlackBody`)
 *   - `matrix`   — the Element/Matrix `m.notice` body (`buildMatrixBody`)
 *
 * Safety rules (enforced here so the API route, the sweep, and the UI preview
 * all share them):
 *   - templates may only reference the allowlisted `{{variables}}` below;
 *     unknown placeholders are left verbatim (never evaluated), and rendered
 *     output is length-bounded;
 *   - custom headers must be `X-*` (case-insensitive), match
 *     `[A-Za-z0-9-]+`, carry no CR/LF, and are capped in count/length;
 *     `Content-*`, `Authorization`, `Cookie`, and `Host` are never allowed —
 *     the transport owns content-type;
 *   - rendered bodies are capped at `MAX_CUSTOM_WEBHOOK_BODY_BYTES` (64 KiB);
 *     oversize bodies are replaced with a truncated generic-JSON body rather
 *     than dropped silently;
 *   - previews redact the destination URL (scheme + host only; path, query, and
 *     fragment stripped) and never include secrets — custom targets carry no secret
 *     field at all (the URL carries its own credential by convention, same as
 *     the legacy `webhook` channel).
 */

import type { AlertPayload } from './adapters'

import {
  buildGenericJsonBody,
  buildMatrixBody,
  buildSlackBody,
  detectAdapter,
} from './adapters'
import { escapeMatrixHtml } from './adapters/matrix'

/** Selectable output format for a custom webhook target. */
export type CustomWebhookFormat =
  | 'auto'
  | 'raw'
  | 'raw-json'
  | 'slack'
  | 'matrix'

/** `raw` is the canonical name; `raw-json` remains accepted for old rows/forms. */
export const CUSTOM_WEBHOOK_FORMATS: readonly CustomWebhookFormat[] = [
  'auto',
  'raw',
  'raw-json',
  'slack',
  'matrix',
]

export function normalizeCustomWebhookFormat(v: unknown): CustomWebhookFormat {
  if (v === 'raw-json') return 'raw'
  return isCustomWebhookFormat(v) ? v : 'auto'
}

export function isCustomWebhookFormat(v: unknown): v is CustomWebhookFormat {
  return (
    typeof v === 'string' &&
    (CUSTOM_WEBHOOK_FORMATS as readonly string[]).includes(v)
  )
}

/** Human labels for the format picker (UI + docs share these). */
export const CUSTOM_WEBHOOK_FORMAT_LABELS: Record<CustomWebhookFormat, string> =
  {
    auto: 'Auto (detect from URL)',
    raw: 'Raw JSON',
    'raw-json': 'Raw JSON',
    slack: 'Slack blocks',
    matrix: 'Element / Matrix notice',
  }

/** A custom webhook target (persisted shape — see `custom-webhook-target-store.ts`). */
export interface CustomWebhookTarget {
  /** Stable id (`cwt_<nanoid-ish>`), assigned at creation. */
  id: string
  /** Operator label, max 64 chars. */
  name: string
  /** Destination HTTPS webhook URL (credential embedded by convention). */
  url: string
  enabled: boolean
  /** Output format override; `auto` = legacy URL detection. */
  format: CustomWebhookFormat
  /** `null` = inherit the global severity floor. */
  minSeverity: 'warning' | 'critical' | null
  /** Optional `{{variable}}` one-liner; empty = adapter default. Max 200 chars. */
  titleTemplate: string
  /** Optional `{{variable}}` detail text; empty = adapter default. Max 2000 chars. */
  bodyTemplate: string
  /** Optional custom request headers (`X-*` only). Capped, sanitized. */
  headers: Record<string, string>
  /** Optional server-only secret headers from a Helm Secret. Never public. */
  secretHeaders?: Record<string, string>
  updatedAt: number
}

/** Draft shape accepted from the UI/API (id/updatedAt assigned server-side). */
export interface CustomWebhookTargetDraft {
  name?: unknown
  url?: unknown
  enabled?: unknown
  format?: unknown
  minSeverity?: unknown
  titleTemplate?: unknown
  bodyTemplate?: unknown
  headers?: unknown
}

/** Public, secret-safe representation returned to the settings UI/API. */
export interface CustomWebhookTargetPublic {
  id: string
  name: string
  enabled: boolean
  format: CustomWebhookFormat
  minSeverity: 'warning' | 'critical' | null
  titleTemplate: string
  bodyTemplate: string
  headers: Record<string, string>
  updatedAt: number
  urlConfigured: boolean
  urlMasked: string
  source: 'd1' | 'helm'
  /** Helm-managed rows are read-only in the UI; D1 rows can be overridden. */
  editable: boolean
}

export const MAX_TARGET_NAME_LENGTH = 64
export const MAX_TITLE_TEMPLATE_LENGTH = 200
export const MAX_BODY_TEMPLATE_LENGTH = 2000
export const MAX_CUSTOM_HEADERS = 8
export const MAX_CUSTOM_HEADER_NAME_LENGTH = 64
export const MAX_CUSTOM_HEADER_VALUE_LENGTH = 512
/** Rendered JSON bodies larger than this are replaced with a truncated body. */
export const MAX_CUSTOM_WEBHOOK_BODY_BYTES = 64 * 1024

/** Custom targets are HTTPS-only at every boundary: UI, env loader, and send. */
export function isHttpsCustomWebhookUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/
/** Case-insensitive exact names that can never be overridden by a target. */
const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'host',
  'content-length',
  'content-type',
  'content-encoding',
  'transfer-encoding',
])
const SECRET_FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  'host',
  'content-length',
  'content-type',
  'content-encoding',
  'transfer-encoding',
])

/**
 * Allowlisted template variables and their resolvers. Every value is coerced
 * to a short plain string; unknown `{{names}}` are left verbatim so a typo is
 * visible instead of silently empty.
 */
const TEMPLATE_VARS: Record<string, (p: AlertPayload) => string> = {
  severity: (p) =>
    p.severity === 'recovery' ? 'RESOLVED' : p.severity.toUpperCase(),
  title: (p) => p.title,
  label: (p) => p.label,
  host: (p) => p.hostLabel,
  hostId: (p) => String(p.hostId),
  checkId: (p) => p.metric,
  value: (p) => (p.value === null ? 'n/a' : String(p.value)),
  timestamp: (p) => p.timestamp,
}

/** Escape operator-controlled text before putting it in Slack mrkdwn. */
function escapeSlackMrkdwn(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeFormatForBuild(
  format: CustomWebhookFormat
): CustomWebhookFormat {
  return format === 'raw-json' ? 'raw' : format
}

export const CUSTOM_WEBHOOK_TEMPLATE_VARS = Object.freeze(
  Object.keys(TEMPLATE_VARS)
)

/**
 * Render a `{{variable}}` template against a payload. Unknown placeholders are
 * preserved verbatim; output is truncated to `maxLength` (with an ellipsis
 * marker) so a runaway template can never blow the payload cap on its own.
 */
export function renderCustomTemplate(
  template: string,
  payload: AlertPayload,
  maxLength: number
): string {
  const rendered = template.replace(
    /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g,
    (m, name) => {
      const resolve = TEMPLATE_VARS[name as string]
      return resolve ? resolve(payload) : m
    }
  )
  if (rendered.length <= maxLength) return rendered
  return `${rendered.slice(0, maxLength)}…(truncated)`
}

/** Sanitize caller-supplied headers: allowlist `X-*`, bounds, no CR/LF. */
export function sanitizeCustomHeaders(raw: unknown): {
  headers: Record<string, string>
  dropped: string[]
} {
  const headers: Record<string, string> = {}
  const dropped: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { headers, dropped }
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const trimmedName = name.trim()
    const trimmedValue = typeof value === 'string' ? value.trim() : ''
    const lower = trimmedName.toLowerCase()
    const ok =
      trimmedName.length > 0 &&
      trimmedName.length <= MAX_CUSTOM_HEADER_NAME_LENGTH &&
      HEADER_NAME_RE.test(trimmedName) &&
      lower.startsWith('x-') &&
      !FORBIDDEN_HEADER_NAMES.has(lower) &&
      !/[\r\n]/.test(trimmedName) &&
      trimmedValue.length > 0 &&
      trimmedValue.length <= MAX_CUSTOM_HEADER_VALUE_LENGTH &&
      !/[\r\n]/.test(trimmedValue)
    if (!ok) {
      dropped.push(trimmedName || '(empty)')
      continue
    }
    if (Object.keys(headers).length >= MAX_CUSTOM_HEADERS) {
      dropped.push(trimmedName)
      continue
    }
    // Last write wins on case-variant duplicates — but key on the FIRST-seen
    // casing so the outgoing header name is stable.
    const existing = Object.keys(headers).find((k) => k.toLowerCase() === lower)
    headers[existing ?? trimmedName] = trimmedValue
  }
  return { headers, dropped }
}

export const MAX_CUSTOM_SECRET_HEADERS = 8

/**
 * Sanitize headers sourced from a deployment Secret. Unlike UI headers, this
 * permits `Authorization` for Matrix/ bearer integrations, but never permits
 * Cookie/Host/content headers. The result is server-only and never serialized
 * into a public target response.
 */
export function sanitizeSecretHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const trimmedName = name.trim()
    const trimmedValue = typeof value === 'string' ? value.trim() : ''
    const lower = trimmedName.toLowerCase()
    const allowed =
      (lower === 'authorization' || lower.startsWith('x-')) &&
      HEADER_NAME_RE.test(trimmedName) &&
      trimmedName.length <= MAX_CUSTOM_HEADER_NAME_LENGTH &&
      trimmedValue.length > 0 &&
      trimmedValue.length <= MAX_CUSTOM_HEADER_VALUE_LENGTH &&
      !/[\r\n]/.test(trimmedName) &&
      !/[\r\n]/.test(trimmedValue) &&
      !SECRET_FORBIDDEN_HEADER_NAMES.has(lower)
    if (!allowed || Object.keys(headers).length >= MAX_CUSTOM_SECRET_HEADERS)
      continue
    headers[trimmedName] = trimmedValue
  }
  return headers
}

/** Validate a draft; returns the sanitized target fields or a list of errors. */
export function validateCustomWebhookDraft(draft: CustomWebhookTargetDraft): {
  ok: boolean
  errors: string[]
  name: string
  format: CustomWebhookFormat
  minSeverity: 'warning' | 'critical' | null
  titleTemplate: string
  bodyTemplate: string
  headers: Record<string, string>
} {
  const errors: string[] = []
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) errors.push('Name is required')
  else if (name.length > MAX_TARGET_NAME_LENGTH) {
    errors.push(`Name must be ≤ ${MAX_TARGET_NAME_LENGTH} characters`)
  }
  const format = isCustomWebhookFormat(draft.format)
    ? normalizeCustomWebhookFormat(draft.format)
    : 'auto'
  if (
    draft.format !== undefined &&
    draft.format !== null &&
    draft.format !== '' &&
    !isCustomWebhookFormat(draft.format)
  ) {
    errors.push('Format must be auto, raw, slack, or matrix')
  }
  const minSeverity =
    draft.minSeverity === 'warning' || draft.minSeverity === 'critical'
      ? draft.minSeverity
      : null
  const titleTemplate =
    typeof draft.titleTemplate === 'string' ? draft.titleTemplate : ''
  const bodyTemplate =
    typeof draft.bodyTemplate === 'string' ? draft.bodyTemplate : ''
  if (titleTemplate.length > MAX_TITLE_TEMPLATE_LENGTH) {
    errors.push(
      `Title template must be ≤ ${MAX_TITLE_TEMPLATE_LENGTH} characters`
    )
  }
  if (bodyTemplate.length > MAX_BODY_TEMPLATE_LENGTH) {
    errors.push(
      `Body template must be ≤ ${MAX_BODY_TEMPLATE_LENGTH} characters`
    )
  }
  const { headers, dropped } = sanitizeCustomHeaders(draft.headers)
  for (const d of dropped) {
    errors.push(
      `Header "${d}" is not allowed (use X-* names, ≤ ${MAX_CUSTOM_HEADER_VALUE_LENGTH}-char values, no secrets)`
    )
  }
  return {
    ok: errors.length === 0,
    errors,
    name,
    format,
    minSeverity,
    titleTemplate,
    bodyTemplate,
    headers,
  }
}

/**
 * Build the outgoing JSON body for a target + payload. Applies the target's
 * explicit format (or legacy URL detection for `auto`), then overlays the
 * title/body templates:
 *   - slack: overrides the top-level `text` fallback AND the header block;
 *     blocks/attachments stay adapter-built (presentation stays valid);
 *   - matrix: overrides `body` and rebuilds `formatted_body` from the escaped
 *     template text;
 *   - raw-json / auto-generic: overrides `text` and appends the rendered
 *     `customTitle`/`customBody` fields so structured receivers can branch.
 * Bodies over the byte cap are replaced with a truncated generic-JSON body.
 */
export function buildCustomTargetBody(
  target: Pick<
    CustomWebhookTarget,
    'url' | 'format' | 'titleTemplate' | 'bodyTemplate'
  >,
  payload: AlertPayload,
  /** Pre-rendered one-line summary (severity/recovery aware) for the legacy path. */
  text?: string
): { body: unknown; adapterId: string; truncated: boolean } {
  const titleTemplate = target.titleTemplate.trim()
  const bodyTemplate = target.bodyTemplate.trim()
  const title = titleTemplate
    ? renderCustomTemplate(titleTemplate, payload, MAX_TITLE_TEMPLATE_LENGTH)
    : null
  const bodyText = bodyTemplate
    ? renderCustomTemplate(bodyTemplate, payload, MAX_BODY_TEMPLATE_LENGTH)
    : null

  let adapterId: string
  let body: unknown
  const format = normalizeFormatForBuild(target.format)

  if (format === 'slack') {
    adapterId = 'slack'
    const slack = buildSlackBody(payload)
    if (title || bodyText) {
      const summary = [title, bodyText].filter(Boolean).join(' — ')
      const safeTitle = title ? escapeSlackMrkdwn(title) : null
      const safeBody = bodyText ? escapeSlackMrkdwn(bodyText) : null
      const blocks = slack.attachments[0]?.blocks.map((block) => {
        if (block.type === 'header' && safeTitle) {
          return {
            ...block,
            text: { ...(block.text as object), text: safeTitle },
          }
        }
        if (block.type === 'section' && safeBody && block.text) {
          return { ...block, text: { ...block.text, text: safeBody } }
        }
        return block
      })
      body = {
        text: summary ? escapeSlackMrkdwn(summary) : slack.text,
        attachments: [{ ...slack.attachments[0], blocks }],
      }
    } else {
      body = slack
    }
  } else if (format === 'matrix') {
    adapterId = 'matrix'
    if (title || bodyText) {
      const plain = [title, bodyText].filter(Boolean).join(' — ')
      body = {
        msgtype: 'm.notice',
        body: plain,
        format: 'org.matrix.custom.html',
        formatted_body: [title, bodyText]
          .filter(Boolean)
          .map((t) => escapeMatrixHtml(t as string))
          .join('<br>'),
      }
    } else {
      body = buildMatrixBody(payload)
    }
  } else if (format === 'raw') {
    adapterId = 'generic-json'
    const json = buildGenericJsonBody(payload)
    body =
      title || bodyText
        ? { ...json, customTitle: title, customBody: bodyText }
        : json
  } else {
    const adapter = detectAdapter(target.url)
    adapterId = adapter.id
    // Keep the legacy wrapper for auto-detected targets (backward compatible):
    // only attach custom template fields for the generic fallback, so
    // provider-specific shapes (Discord embeds, Teams cards) are untouched.
    if (adapterId === 'generic-json' && (title || bodyText)) {
      const json = buildGenericJsonBody(payload)
      body = { ...json, customTitle: title, customBody: bodyText }
    } else if (title || bodyText) {
      // Auto + templates on a provider-shaped target: fall back to the
      // plain-text wrapper with the rendered template text (never mutate a
      // provider embed/card).
      const summary = [title, bodyText].filter(Boolean).join(' — ')
      const safeSummary =
        adapterId === 'slack' ? escapeSlackMrkdwn(summary) : summary
      body = { text: safeSummary, content: safeSummary }
    } else {
      // No templates: the exact legacy `{ text, content }` wrapper.
      const summary =
        text ??
        `[${payload.severity === 'recovery' ? 'RESOLVED' : payload.severity.toUpperCase()}] ${payload.title} — ${payload.label} (host ${payload.hostLabel})`
      body = { text: summary, content: summary }
    }
  }

  const serialized = JSON.stringify(body)
  const bodyBytes = new TextEncoder().encode(serialized).byteLength
  if (bodyBytes > MAX_CUSTOM_WEBHOOK_BODY_BYTES) {
    const boundedPayload: AlertPayload = {
      ...payload,
      title: payload.title.slice(0, 200),
      label: payload.label.slice(0, 500),
      hostLabel: payload.hostLabel.slice(0, 120),
    }
    const fallback = buildGenericJsonBody(boundedPayload)
    const truncatedLabel = `${fallback.label.slice(0, 200)}…(truncated oversize body)`
    return {
      body: { ...fallback, label: truncatedLabel, text: truncatedLabel },
      adapterId,
      truncated: true,
    }
  }
  return { body, adapterId, truncated: false }
}

/** Redact a destination URL for previews/logs: keep only scheme + authority. */
export function redactWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}/••••`
  } catch {
    return 'https://••••'
  }
}

/** A sample payload used for previews (never a real incident). */
export function samplePreviewPayload(): AlertPayload {
  return {
    severity: 'critical',
    hostLabel: 'db-prod-01',
    hostId: 0,
    metric: 'failed-mutations',
    value: 3,
    warnThreshold: 1,
    critThreshold: 2,
    title: 'Mutations failing',
    label: '3 mutations stuck for 15m',
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

export interface CustomTargetPreview {
  format: CustomWebhookFormat
  adapterId: string
  /** Redacted destination — safe to render in the UI or return from the API. */
  redactedUrl: string
  headers: Record<string, string>
  body: unknown
  truncated: boolean
  /** Pretty-printed body for the preview pane. */
  bodyJson: string
}

/**
 * Build a redacted preview for a target draft/shape. Pure — shared by the
 * client preview pane and the API preview endpoint so both render identically.
 */
export function buildCustomTargetPreview(
  target: Pick<
    CustomWebhookTarget,
    'url' | 'format' | 'titleTemplate' | 'bodyTemplate' | 'headers'
  >,
  payload: AlertPayload = samplePreviewPayload()
): CustomTargetPreview {
  const { body, adapterId, truncated } = buildCustomTargetBody(target, payload)
  const bodyJson = JSON.stringify(body, null, 2)
  return {
    format: target.format,
    adapterId,
    redactedUrl: redactWebhookUrl(target.url),
    headers: { ...target.headers },
    body,
    truncated,
    bodyJson:
      bodyJson.length > 8000
        ? `${bodyJson.slice(0, 8000)}\n…(preview truncated)`
        : bodyJson,
  }
}

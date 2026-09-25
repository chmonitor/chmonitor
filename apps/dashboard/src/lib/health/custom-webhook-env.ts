/**
 * Server-side loader for GitOps/Helm-declared custom alert targets.
 *
 * The chart writes only non-secret target metadata to
 * `HEALTH_ALERT_WEBHOOK_TARGETS`; webhook URLs and optional secret headers are
 * injected as separate environment variables. Keeping this parser server-only
 * prevents secret-bearing environment values from entering the browser bundle.
 */

import type { CustomWebhookTarget } from './custom-webhook-targets'

import {
  isCustomWebhookFormat,
  isHttpsCustomWebhookUrl,
  normalizeCustomWebhookFormat,
  sanitizeCustomHeaders,
  sanitizeSecretHeaders,
  validateCustomWebhookDraft,
} from './custom-webhook-targets'

interface RawEnvTarget {
  name?: unknown
  enabled?: unknown
  format?: unknown
  minSeverity?: unknown
  titleTemplate?: unknown
  textTemplate?: unknown
  bodyTemplate?: unknown
  headers?: unknown
  urlEnv?: unknown
  headersEnv?: unknown
}

function asRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

function parseHeaders(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const values: Record<string, string> = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      if (typeof row.name === 'string' && typeof row.value === 'string') {
        values[row.name] = row.value
      }
    }
    return sanitizeCustomHeaders(values).headers
  }
  return sanitizeCustomHeaders(asRecord(raw)).headers
}

function parseSecretHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    return sanitizeSecretHeaders(JSON.parse(raw) as unknown)
  } catch {
    return {}
  }
}

/**
 * Parse the chart's declarative target list. Invalid entries are ignored rather
 * than throwing from a cron sweep; runtime delivery still revalidates URLs.
 */
export function loadEnvCustomWebhookTargets(
  env: Record<string, string | undefined> = process.env
): CustomWebhookTarget[] {
  const raw = env.HEALTH_ALERT_WEBHOOK_TARGETS
  if (!raw) return []

  let entries: unknown
  try {
    entries = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []

  const targets: CustomWebhookTarget[] = []
  for (const value of entries.slice(0, 32)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as RawEnvTarget
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const urlEnv = typeof entry.urlEnv === 'string' ? entry.urlEnv : ''
    const url = urlEnv ? (env[urlEnv] ?? '').trim() : ''
    if (!name || !url || !isHttpsCustomWebhookUrl(url)) continue

    const format = isCustomWebhookFormat(entry.format)
      ? normalizeCustomWebhookFormat(entry.format)
      : 'auto'
    const declaredHeaders = parseHeaders(entry.headers)
    const validated = validateCustomWebhookDraft({
      name,
      url,
      format,
      minSeverity: entry.minSeverity,
      titleTemplate: entry.titleTemplate,
      bodyTemplate: entry.bodyTemplate ?? entry.textTemplate,
      headers: declaredHeaders,
    })
    if (!validated.ok) continue

    const secretHeaders = parseSecretHeaders(
      typeof entry.headersEnv === 'string' ? env[entry.headersEnv] : undefined
    )
    targets.push({
      id: `env:${name}`,
      name,
      url,
      enabled: entry.enabled !== false,
      format: validated.format,
      minSeverity: validated.minSeverity,
      titleTemplate: validated.titleTemplate,
      bodyTemplate: validated.bodyTemplate,
      headers: validated.headers,
      secretHeaders,
      updatedAt: 0,
    })
  }
  return targets
}

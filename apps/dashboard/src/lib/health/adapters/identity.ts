/**
 * Deployment-identity helpers shared by the adapters (pure).
 *
 * Several chmonitor deployments can post into one channel; these render the
 * optional `instanceName` / `metadata` / `dashboardUrl` fields of an
 * {@link AlertPayload}. Every helper returns '' / [] when the fields are unset,
 * so adapter output stays byte-identical for deployments that configure none.
 */

import type { AlertPayload } from './types'

type IdentityFields = Pick<
  AlertPayload,
  'instanceName' | 'dashboardUrl' | 'metadata'
>

/** `[prod-eu] ` prefix for one-line summaries, or '' when no instance is set. */
export function instancePrefix(payload: IdentityFields): string {
  return payload.instanceName ? `[${payload.instanceName}] ` : ''
}

/**
 * Append the dashboard deep link to a one-line `{ text, content }` summary so
 * the plain wrapper carries the same link the rich bodies do. Unchanged when no
 * link is configured or the text already has it.
 */
export function withDashboardLink(
  text: string,
  payload: Pick<AlertPayload, 'dashboardUrl'>
): string {
  const url = payload.dashboardUrl
  if (!url || text.includes(url)) return text
  return `${text}\n${url}`
}

/** `key=value` strings for the payload metadata, in insertion order. */
export function metadataPairs(payload: IdentityFields): string[] {
  return Object.entries(payload.metadata ?? {}).map(([k, v]) => `${k}=${v}`)
}

/**
 * Plain identity line, e.g. `instance prod-eu · team=db · region=eu`, or ''
 * when neither instance nor metadata is set. Callers escape it for their
 * markup.
 */
export function identityLine(payload: IdentityFields): string {
  const parts: string[] = []
  if (payload.instanceName) parts.push(`instance ${payload.instanceName}`)
  parts.push(...metadataPairs(payload))
  return parts.join(' · ')
}

/**
 * One dashboard link for a whole digest. `dashboardUrl` is per host
 * (`<base>/health?host=<id>`), so a digest spanning several hosts links to the
 * same page without the `host` param; a single-host digest keeps the link.
 */
export function digestDashboardUrl(
  payloads: readonly AlertPayload[]
): string | undefined {
  const first = payloads.find((p) => p.dashboardUrl)?.dashboardUrl
  if (!first) return undefined
  if (new Set(payloads.map((p) => p.hostId)).size <= 1) return first
  try {
    const url = new URL(first)
    url.searchParams.delete('host')
    return url.toString()
  } catch {
    return first
  }
}

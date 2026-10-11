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

import type { AlertIdentity } from './alert-dispatcher'

/**
 * Server deployment identity for a browser-built test alert. Best effort: on
 * any failure the test still sends, just without the identity fields.
 */
export async function fetchAlertIdentity(): Promise<AlertIdentity | undefined> {
  try {
    const res = await fetch('/api/v1/health/alert-identity')
    if (!res.ok) return undefined
    return (await res.json()) as AlertIdentity
  } catch {
    return undefined
  }
}

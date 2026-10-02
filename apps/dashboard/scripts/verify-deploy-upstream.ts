/**
 * Decide whether a failed /api/v1/menu-counts call means OUR worker is broken
 * or the monitored ClickHouse upstream is down.
 *
 * Since #3530, menu-counts answers 500 when every count is unresolved (the host
 * is not answering) instead of faking a 200. That is correct for users, but it
 * made verify-deploy fail every time the public demo origin flapped (#3487).
 *
 * The tie-breaker is /api/v1/host-status, an independent ping of the same host
 * through the same worker. If it ALSO reports the host failing with a
 * structured 5xx `{ success: false }` from our route (or hangs), the upstream is
 * down and the deploy is fine. If host-status says the host is up, the
 * menu-counts 500 is our bug and must fail the gate.
 */

export type HostStatusProbe =
  | { kind: 'response'; status: number; json: unknown }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }

export function isUpstreamDown(probe: HostStatusProbe): boolean {
  if (probe.kind === 'timeout') return true
  if (probe.kind === 'error') return false
  const body = probe.json as { success?: unknown } | null
  return probe.status >= 500 && body?.success === false
}

/**
 * Server-side healthchecks.io ping dispatch (feat #2665).
 *
 * healthchecks.io accepts a bare GET to a check's unique ping URL, or
 * `<url>/fail` for a failure signal. The cron sweep uses this to ping a
 * healthchecks.io check on each alert/recovery — previously this was CLIENT-only
 * (`alert-dispatcher.ts`'s `fireHealthchecks`, which routes through the webhook
 * proxy because the browser can't egress directly). Server-side there is no CORS
 * barrier, so the sweep GETs the URL directly.
 *
 * NOTE: the alert→base / recovery→`/fail` mapping mirrors the client dispatcher
 * (`fireHealthchecks` in `alert-dispatcher.ts`) EXACTLY so the two paths agree —
 * that function is the single source of truth for the ping semantics. Fails open
 * (returns `false`, never throws) like every other sweep dispatch.
 *
 * A saved URL is re-checked against the host guard at send time (DNS can change
 * after save) and redirects are refused. The operator's env-configured URL
 * (`HEALTH_ALERT_HEALTHCHECKS_URL`) is trusted and skips both, mirroring ntfy.
 * A blocked URL is never fetched and is never logged.
 */

import { getServerHealthchecksUrl } from './server-alert-config'
import { debug } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

/** Injectable dependencies (tests override fetch and DNS). */
export interface HealthchecksDispatchDeps {
  fetchImpl?: typeof fetch
  resolveHostAddresses?: Parameters<typeof validateHostUrl>[1]
}

export async function dispatchHealthchecks(
  url: string,
  kind: 'alert' | 'recovery',
  deps: HealthchecksDispatchDeps = {}
): Promise<boolean> {
  const trimmed = url.trim()
  const envUrl = getServerHealthchecksUrl()
  const trusted = envUrl !== '' && trimmed === envUrl
  if (!trusted && (await validateHostUrl(trimmed, deps.resolveHostAddresses))) {
    debug('[health] skipping healthchecks ping: blocked destination')
    return false
  }

  const base = trimmed.replace(/\/+$/, '')
  const target = kind === 'recovery' ? `${base}/fail` : base
  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await doFetch(target, {
      method: 'GET',
      ...(trusted ? {} : { redirect: 'error' as const }),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

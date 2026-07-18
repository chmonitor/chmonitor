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
 * (returns `false`, never throws) like every other sweep dispatch. The URL was
 * SSRF-validated when the operator saved it (or is an env value they control).
 */
export async function dispatchHealthchecks(
  url: string,
  kind: 'alert' | 'recovery'
): Promise<boolean> {
  const base = url.replace(/\/+$/, '')
  const target = kind === 'recovery' ? `${base}/fail` : base
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

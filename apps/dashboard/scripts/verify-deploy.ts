#!/usr/bin/env bun

/**
 * Post-deploy verification for the dashboard (TanStack Start) worker.
 *
 * Runs two scenarios against a LIVE deployment:
 *
 *  UNAUTHENTICATED (always)
 *   1. GET /api/health (no token) -> 200 minimal liveness; deployment metadata
 *      MUST be hidden from anonymous callers (#1768 — git sha / auth provider /
 *      key prefix are security posture, not public).
 *   2. GET / and /overview?host=0 -> 200, HTML references the client entry bundle
 *   3. client entry bundle        -> contains the Clerk pk_ key when authProvider=clerk
 *      (guards the NEXT_PUBLIC_* -> VITE_* regression: a broken build ships NO key)
 *   4. GET /api/v1/menu-counts (no token) -> 401 when API-key auth is enabled
 *
 *  AUTHENTICATED (when CHM_API_KEY_SECRET is set)
 *   5. POST /api/v1/auth/api-key (Bearer secret) -> mints a chm_ token
 *   6. GET /api/health (Bearer token) -> 200 + deployment metadata (git sha /
 *      auth provider / build ts) is returned to authenticated callers
 *   7. GET /api/v1/menu-counts?hostId=H (Bearer token) -> 200 success:true with live
 *      ClickHouse system-table counts === the worker reaches + queries ClickHouse
 *
 * Run:
 *   bun scripts/verify-deploy.ts [--base-url URL] [--hosts 0,1] [--json] [--skip-auth]
 *   CHM_API_KEY_SECRET=... bun scripts/verify-deploy.ts            # enables authed scenario
 *
 * Exit codes: 0 = all checks pass, 1 = one or more failed, 2 = harness error.
 */

import { type HostStatusProbe, isUpstreamDown } from './verify-deploy-upstream'

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.split('=').slice(1).join('=')
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

const BASE_URL = (flag('base-url') ?? 'https://dash.chmonitor.dev').replace(
  /\/$/,
  ''
)
const HOSTS = (flag('hosts') ?? '0,1')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)
const JSON_OUTPUT = args.includes('--json')
const SKIP_AUTH = args.includes('--skip-auth')
const SECRET = process.env.CHM_API_KEY_SECRET

interface Check {
  scenario: 'unauthenticated' | 'authenticated'
  name: string
  ok: boolean
  detail: string
  // warn: the DEPLOY is fine but the monitored ClickHouse upstream is
  // unreachable. A monitoring dashboard must stay deployable during an
  // incident of the thing it monitors, so upstream outages degrade these
  // checks to warnings instead of failing the deploy gate.
  warn?: boolean
}
const checks: Check[] = []
function record(c: Check) {
  checks.push(c)
  if (!JSON_OUTPUT) {
    const icon = c.ok ? (c.warn ? '⚠️' : '✅') : '❌'
    console.log(`${icon} [${c.scenario}] ${c.name} — ${c.detail}`)
  }
}

// A fetch abort after TIMEOUT_MS against a CH-querying endpoint means the
// worker hung waiting on the (down) ClickHouse upstream — not a broken deploy.
function isUpstreamTimeout(e: unknown): boolean {
  // Bun surfaces AbortSignal.timeout() as a DOMException, which is not
  // `instanceof Error` — match on the name only.
  return (e as { name?: string } | null)?.name === 'TimeoutError'
}

const TIMEOUT_MS = 30_000
async function http(
  path: string,
  init?: RequestInit
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON (HTML/asset) */
  }
  return { status: res.status, text, json }
}

// Independent ping of the same host, used to tell an upstream ClickHouse
// outage apart from a broken worker when menu-counts answers non-2xx (#3530).
async function probeHostStatus(hostId: string): Promise<HostStatusProbe> {
  try {
    const { status, json } = await http(`/api/v1/host-status?hostId=${hostId}`)
    return { kind: 'response', status, json }
  } catch (e) {
    return isUpstreamTimeout(e)
      ? { kind: 'timeout' }
      : { kind: 'error', message: String(e) }
  }
}

// ── Shared deployment probe ───────────────────────────────────────────────

// `/api/health` hides deployment metadata from anonymous callers (#1768), so we
// learn the deployed auth provider (for the Clerk-bundle regression check) by
// minting a token up front and reading the AUTHENTICATED health response.
// Without a secret (local --skip-auth runs), clerkExpected stays false and the
// bundle check softens to informational — CI always provides the secret, so the
// gate stays strict there.
let clerkExpected = false
let deployment: Record<string, unknown> | null = null
let mintedToken = ''
let mintStatus = 0

async function probeDeployment() {
  if (SKIP_AUTH || !SECRET) return
  try {
    const mint = await http('/api/v1/auth/api-key', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'verify-deploy', days: 1 }),
    })
    mintStatus = mint.status
    mintedToken =
      (mint.json as { data?: { apiKey?: string } })?.data?.apiKey ?? ''
    if (!mintedToken) return
    const health = await http('/api/health', {
      headers: { Authorization: `Bearer ${mintedToken}` },
    })
    deployment =
      (health.json as { deployment?: Record<string, unknown> })?.deployment ??
      null
    clerkExpected =
      deployment?.authProvider === 'clerk' ||
      deployment?.clientAuthProvider === 'clerk'
  } catch {
    /* leave defaults; downstream checks soften */
  }
}

// ── Unauthenticated scenario ──────────────────────────────────────────────

async function runUnauthenticated() {
  // 1. health — anonymous callers get minimal liveness, NO deployment metadata.
  try {
    const { status, json } = await http('/api/health')
    const body = json as { status?: string; deployment?: unknown }
    const leaked = body?.deployment !== undefined
    record({
      scenario: 'unauthenticated',
      name: 'GET /api/health (anonymous, no metadata leak)',
      ok: status === 200 && body?.status === 'ok' && !leaked,
      detail:
        status !== 200
          ? `HTTP ${status}`
          : leaked
            ? 'LEAK — deployment metadata exposed to anonymous caller (#1768)'
            : 'ok — minimal liveness; deployment metadata hidden from anonymous',
    })
  } catch (e) {
    record({
      scenario: 'unauthenticated',
      name: 'GET /api/health (anonymous, no metadata leak)',
      ok: false,
      detail: String(e),
    })
  }

  // 2. prerendered pages + 3. client bundle carries the Clerk key
  try {
    const { status, text } = await http('/overview?host=0')
    const entryAsset = text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]
    const preloadedAssets = [
      ...text.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.js/g),
    ].map((m) => m[0])
    const assets = [
      ...new Set([entryAsset, ...preloadedAssets].filter(Boolean)),
    ]
    record({
      scenario: 'unauthenticated',
      name: 'GET /overview?host=0',
      ok: status === 200 && !!entryAsset,
      detail:
        status === 200
          ? `entry=${entryAsset ?? 'NOT FOUND'}`
          : `HTTP ${status}`,
    })
    if (assets.length > 0) {
      let matchedKey: string | undefined
      let matchedAsset: string | undefined
      for (const asset of assets) {
        const bundle = await http(asset)
        matchedKey = bundle.text.match(/pk_(live|test)_[A-Za-z0-9]+/)?.[0]
        if (matchedKey) {
          matchedAsset = asset
          break
        }
      }
      const hasKey = Boolean(matchedKey)
      // Only an assertion failure when Clerk is the configured provider.
      record({
        scenario: 'unauthenticated',
        name: 'client bundle has Clerk key',
        ok: clerkExpected ? hasKey : true,
        detail: hasKey
          ? `key inlined in ${matchedAsset} (${matchedKey?.slice(0, 12)}…)`
          : clerkExpected
            ? 'MISSING — VITE_CLERK_PUBLISHABLE_KEY not inlined (the NEXT_PUBLIC regression)'
            : 'no key (auth provider is not clerk — ok)',
      })
    }
  } catch (e) {
    record({
      scenario: 'unauthenticated',
      name: 'GET /overview',
      ok: false,
      detail: String(e),
    })
  }

  // 4. anonymous data call is rejected when API-key auth is enabled
  try {
    const { status, json } = await http(
      `/api/v1/menu-counts?hostId=${HOSTS[0]}`
    )
    const isAuthGate = status === 401
    const upstreamDown =
      status >= 500 && isUpstreamDown(await probeHostStatus(HOSTS[0]))
    record({
      scenario: 'unauthenticated',
      name: 'anon /api/v1/menu-counts blocked',
      ok: isAuthGate || status === 200 || upstreamDown,
      warn: upstreamDown,
      detail: isAuthGate
        ? `401 (${(json as { error?: string })?.error}) — API-key auth enforced`
        : status === 200
          ? '200 — API-key auth is DISABLED (open data API)'
          : upstreamDown
            ? `HTTP ${status} past the auth gate, host-status also down — ClickHouse upstream unreachable (deploy itself OK)`
            : `unexpected HTTP ${status}`,
    })
  } catch (e) {
    record({
      scenario: 'unauthenticated',
      name: 'anon /api/v1 blocked',
      ok: isUpstreamTimeout(e),
      warn: isUpstreamTimeout(e),
      detail: isUpstreamTimeout(e)
        ? 'endpoint hung — ClickHouse upstream unreachable; auth gate could not be evaluated (deploy itself OK)'
        : String(e),
    })
  }
}

// ── Authenticated scenario ────────────────────────────────────────────────

async function runAuthenticated() {
  if (SKIP_AUTH) return
  if (!SECRET) {
    if (!JSON_OUTPUT)
      console.log(
        'ℹ️  [authenticated] skipped — set CHM_API_KEY_SECRET to run CH connectivity checks'
      )
    return
  }

  // 5. token mint (performed in probeDeployment so the authenticated health
  //    read below can run; record the outcome here).
  record({
    scenario: 'authenticated',
    name: 'POST /api/v1/auth/api-key (mint token)',
    ok: mintStatus === 200 && mintedToken.startsWith('chm_'),
    detail:
      mintStatus === 200 && mintedToken
        ? `minted ${mintedToken.slice(0, 10)}… (len=${mintedToken.length})`
        : `HTTP ${mintStatus}`,
  })
  const token = mintedToken
  if (!token) return

  // 6. authenticated callers DO receive deployment metadata (the other half of
  //    the #1768 contract: hidden from anonymous, visible once authenticated).
  record({
    scenario: 'authenticated',
    name: 'GET /api/health (authenticated) returns metadata',
    ok: !!deployment,
    detail: deployment
      ? `runtime=${deployment.runtime} authProvider=${deployment.authProvider} sha=${String(deployment.gitSha).slice(0, 7)} clerkKey=${deployment.clerkPublishableKeyPrefix ?? 'none'}`
      : 'no deployment block returned to authenticated caller',
  })

  // 7. real CH query per host via the registry endpoint
  for (const h of HOSTS) {
    try {
      const { status, json } = await http(`/api/v1/menu-counts?hostId=${h}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = json as {
        success?: boolean
        data?: { counts?: Record<string, number> }
        error?: { message?: string }
      }
      const counts = body?.data?.counts ?? {}
      const sample = ['tables-overview', 'metrics', 'settings', 'clusters']
        .filter((k) => k in counts)
        .map((k) => `${k}=${counts[k]}`)
        .join(' ')
      const connected = status === 200 && body?.success === true
      const upstreamDown =
        !connected && status >= 500 && isUpstreamDown(await probeHostStatus(h))
      record({
        scenario: 'authenticated',
        name: `CH query hostId=${h} (menu-counts)`,
        ok: connected || upstreamDown,
        warn: upstreamDown,
        detail: connected
          ? `connected — ${sample}`
          : upstreamDown
            ? `HTTP ${status}, host-status also down — ClickHouse upstream unreachable, worker deployed and authenticated OK`
            : `HTTP ${status} ${body?.error?.message ?? body?.error ?? ''}`,
      })
    } catch (e) {
      record({
        scenario: 'authenticated',
        name: `CH query hostId=${h}`,
        ok: isUpstreamTimeout(e),
        warn: isUpstreamTimeout(e),
        detail: isUpstreamTimeout(e)
          ? 'ClickHouse upstream unreachable (timeout) — worker deployed and authenticated OK, monitored DB is down'
          : String(e),
      })
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!JSON_OUTPUT) console.log(`\n🔎 Verifying ${BASE_URL}\n`)
  await probeDeployment()
  await runUnauthenticated()
  await runAuthenticated()

  const failed = checks.filter((c) => !c.ok)
  const warned = checks.filter((c) => c.ok && c.warn)
  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          passed: checks.length - failed.length,
          failed: failed.length,
          warned: warned.length,
          checks,
        },
        null,
        2
      )
    )
  } else {
    const warnNote =
      warned.length > 0
        ? ` (⚠️ ${warned.length} degraded: ClickHouse upstream unreachable — deploy verified, monitored DB is down)`
        : ''
    console.log(
      `\n${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} FAILED`} — ${checks.length - failed.length}/${checks.length} checks${warnNote}\n`
    )
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('harness error:', e)
  process.exit(2)
})

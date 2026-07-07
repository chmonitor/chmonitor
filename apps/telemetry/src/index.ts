// chmonitor telemetry collector — the ingest endpoint that CHM_TELEMETRY_ENDPOINT
// points at. Receives the anonymous instance ping (and optional aggregate
// events) emitted by apps/dashboard/src/lib/telemetry and records them to
// Cloudflare Analytics Engine.
//
// Privacy contract (mirrors the dashboard client, defense-in-depth):
//   - Accepts ONLY a closed, validated shape. Unknown fields are ignored.
//   - instance_hash is a SHA-256 hex digest of a random local id — opaque, not
//     reversible to any identity. It is the only per-instance value, used purely
//     to count distinct installs.
//   - ch_version is accepted only as MAJOR.MINOR (e.g. "24.8"); anything else is
//     dropped. deploy_target / ch_flavor are coerced to a known enum or dropped.
//   - No IPs, hostnames, query text, or free-text are stored. The request IP is
//     never written to Analytics Engine.
//
// Auth: /v1/ping and /v1/event are unauthenticated, write-only ingest paths.
// The ONLY read-back over HTTP is GET /v1/summary — a public, AGGREGATE-ONLY
// view (distinct-install counts by deploy_target / ch_version). No
// instance_hash, IP, hostname, or free-text is ever exposed by it — only
// integer COUNT(DISTINCT instance_hash) values. The raw dataset remains
// queryable only from the project's Cloudflare account (D1 + Analytics Engine).

export interface Env {
  CHM_TELEMETRY_AE: AnalyticsEngineDataset
  // Optional forever-retention store. Analytics Engine keeps data for only 3
  // months; when a D1 binding is present we ALSO record one deduped row per
  // install per UTC day, which D1 keeps indefinitely (CF-native, free tier).
  // Deploy works without it (AE-only) until the binding is configured.
  CHM_TELEMETRY_DB?: D1Database
}

const MAX_BODY_BYTES = 2048

// These enums intentionally mirror the dashboard's canonical definitions
// (apps/dashboard/src/lib/telemetry/environment.ts → DeployTarget/ChFlavor,
// events.ts → TELEMETRY_EVENTS). They are duplicated rather than imported to
// keep this worker a zero-dependency standalone deploy unit; keep them in sync.
const DEPLOY_TARGETS = new Set(['docker', 'helm', 'cf', 'dev', 'unknown'])
const CH_FLAVORS = new Set(['oss', 'altinity', 'cloud', 'unknown'])
const PLATFORMS = new Set([
  'windows',
  'macos',
  'linux',
  'android',
  'ios',
  'unknown',
])
// ISO 3166-1 alpha-2 codes (common countries only - validate format, not membership)
const COUNTRY_CODE = /^[a-z]{2}$/i
const EVENTS = new Set([
  'app_loaded',
  'cluster_connected',
  'health_viewed',
  'queries_viewed',
  'ai_query_sent',
])

const HEX64 = /^[0-9a-f]{64}$/
const MAJOR_MINOR = /^\d{1,3}\.\d{1,3}$/

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

const noContent = () => new Response(null, { status: 204, headers: CORS })
const bad = (status: number, msg: string) =>
  new Response(msg, { status, headers: CORS })

/** Coerce to a known enum value or fall back. */
function asEnum(v: unknown, set: Set<string>, fallback: string): string {
  return typeof v === 'string' && set.has(v) ? v : fallback
}

/** Accept only a MAJOR.MINOR version string, else ''. */
function asVersion(v: unknown): string {
  return typeof v === 'string' && MAJOR_MINOR.test(v) ? v : ''
}

async function readBody(req: Request): Promise<unknown | null> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > MAX_BODY_BYTES) return null
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (req.method === 'OPTIONS') return noContent()

    if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return new Response('chmonitor telemetry collector\n', {
        status: 200,
        headers: { 'content-type': 'text/plain', ...CORS },
      })
    }

    if (req.method === 'GET' && pathname === '/v1/summary') {
      return handleSummary(env, req)
    }

    if (req.method !== 'POST') return bad(405, 'method not allowed')

    const body = await readBody(req)
    if (body === null || typeof body !== 'object') {
      return bad(400, 'invalid body')
    }
    const data = body as Record<string, unknown>

    if (pathname === '/v1/ping') {
      const instanceHash = data.instance_hash
      if (typeof instanceHash !== 'string' || !HEX64.test(instanceHash)) {
        return bad(400, 'invalid instance_hash')
      }
      const deployTarget = asEnum(data.deploy_target, DEPLOY_TARGETS, 'unknown')
      const chVersion = asVersion(data.ch_version)
      const chFlavor = asEnum(data.ch_flavor, CH_FLAVORS, 'unknown')
      const country =
        typeof data.country === 'string' && COUNTRY_CODE.test(data.country)
          ? data.country.toLowerCase()
          : 'unknown'
      const platform = asEnum(data.platform, PLATFORMS, 'unknown')

      env.CHM_TELEMETRY_AE.writeDataPoint({
        // index1 — distinct-install key. Count installs with uniqExact(index1).
        indexes: [instanceHash],
        // blob1=kind, blob2=deploy_target, blob3=ch_version, blob4=ch_flavor, blob5=country, blob6=platform
        blobs: ['ping', deployTarget, chVersion, chFlavor, country, platform],
        doubles: [1],
      })

      // Forever retention (optional): AE keeps only 3 months, so when a D1
      // binding is present also record one deduped row per install per UTC day.
      // INSERT OR IGNORE on (day, instance_hash) keeps storage to one row per
      // install per day; D1 retains it indefinitely. Runs after the response.
      if (env.CHM_TELEMETRY_DB) {
        const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
        ctx.waitUntil(
          env.CHM_TELEMETRY_DB.prepare(
            'INSERT OR IGNORE INTO ping_daily (day, instance_hash, deploy_target, ch_version, ch_flavor, country, platform) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
            .bind(
              day,
              instanceHash,
              deployTarget,
              chVersion || null,
              chFlavor || null,
              country || null,
              platform || null
            )
            .run()
            .then(() => undefined)
            .catch(() => undefined)
        )
      }
      return noContent()
    }

    if (pathname === '/v1/event') {
      const event = data.event
      if (typeof event !== 'string' || !EVENTS.has(event)) {
        return bad(400, 'invalid event')
      }
      const props = (data.props ?? {}) as Record<string, unknown>
      const deployTarget = asEnum(
        props.deploy_target,
        DEPLOY_TARGETS,
        'unknown'
      )
      const chVersion = asVersion(props.ch_version)
      const chFlavor = asEnum(props.ch_flavor, CH_FLAVORS, 'unknown')

      env.CHM_TELEMETRY_AE.writeDataPoint({
        // events carry no instance identity — index by event name.
        indexes: [event],
        // blob1=kind, blob2=event, blob3=deploy_target, blob4=ch_version, blob5=ch_flavor
        blobs: ['event', event, deployTarget, chVersion, chFlavor],
        doubles: [1],
      })
      return noContent()
    }

    return bad(404, 'not found')
  },
}

// ---------------------------------------------------------------------------
// GET /v1/summary — public, aggregate-only install counts (anonymous).
// ---------------------------------------------------------------------------
// Reads the D1 forever-store (ping_daily). Every number is a
// COUNT(DISTINCT instance_hash) — distinct installs. Optional
// ?deploy_target=docker|helm|cf|dev|unknown scopes total + by_ch_version to
// that target (by_deploy_target is always global). Cached at the edge for 1h.
//
// Data accumulates from the moment the D1 binding was wired (2026-07-07)
// forward; Analytics Engine still holds the prior ~3 months but is not
// binding-readable, so historical totals are not reflected here.
async function handleSummary(env: Env, req: Request): Promise<Response> {
  const base = summaryShape({
    total: 0,
    byDeployTarget: {},
    byChVersion: [],
    byChFlavor: [],
    byCountry: [],
    byPlatform: [],
  })

  if (!env.CHM_TELEMETRY_DB) {
    return json({ ...base, enabled: false }, 503)
  }

  const { searchParams } = new URL(req.url)
  const targetParam = searchParams.get('deploy_target')
  const scoped =
    targetParam && DEPLOY_TARGETS.has(targetParam) ? targetParam : null

  // Same WHERE clause for total + by-version when scoped; by_deploy_target
  // stays global so the breakdown is always visible.
  const where = scoped ? 'WHERE deploy_target = ?' : ''
  const stmt = (sql: string) =>
    scoped
      ? env.CHM_TELEMETRY_DB!.prepare(sql).bind(scoped)
      : env.CHM_TELEMETRY_DB!.prepare(sql)

  try {
    const [totalRow, byTarget, byVersion, byFlavor, byCountry, byPlatform] =
      await Promise.all([
        stmt(
          `SELECT COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where}`
        ).first<{
          n: number
        }>(),
        env
          .CHM_TELEMETRY_DB!.prepare(
            'SELECT deploy_target, COUNT(DISTINCT instance_hash) AS n FROM ping_daily GROUP BY deploy_target'
          )
          .all<{ deploy_target: string; n: number }>(),
        stmt(
          `SELECT COALESCE(ch_version, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
        ).all<{ v: string; n: number }>(),
        stmt(
          `SELECT COALESCE(ch_flavor, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
        ).all<{ v: string; n: number }>(),
        stmt(
          `SELECT COALESCE(country, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC LIMIT 10`
        ).all<{ v: string; n: number }>(),
        stmt(
          `SELECT COALESCE(platform, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
        ).all<{ v: string; n: number }>(),
      ])

    const byDeployTarget: Record<string, number> = {}
    for (const r of byTarget.results ?? []) {
      byDeployTarget[r.deploy_target] = Number(r.n)
    }

    return json(
      summaryShape({
        total: Number(totalRow?.n ?? 0),
        byDeployTarget,
        byChVersion: (byVersion.results ?? []).map((r) => ({
          ch_version: r.v,
          installs: Number(r.n),
        })),
        byChFlavor: (byFlavor.results ?? []).map((r) => ({
          ch_flavor: r.v,
          installs: Number(r.n),
        })),
        byCountry: (byCountry.results ?? []).map((r) => ({
          country: r.v,
          installs: Number(r.n),
        })),
        byPlatform: (byPlatform.results ?? []).map((r) => ({
          platform: r.v,
          installs: Number(r.n),
        })),
        scopedToDeployTarget: scoped,
      }),
      200
    )
  } catch {
    return json({ ...base, enabled: true, error: 'summary query failed' }, 500)
  }
}

interface SummaryBody {
  summary: string
  anonymous: boolean
  enabled: boolean
  scoped_to_deploy_target: string | null
  total_installs: number
  by_deploy_target: Record<string, number>
  by_ch_version: { ch_version: string; installs: number }[]
  by_ch_flavor: { ch_flavor: string; installs: number }[]
  by_country: { country: string; installs: number }[]
  by_platform: { platform: string; installs: number }[]
  source: string
  generated_at: string
}

function summaryShape(input: {
  total: number
  byDeployTarget: Record<string, number>
  byChVersion: { ch_version: string; installs: number }[]
  byChFlavor: { ch_flavor: string; installs: number }[]
  byCountry: { country: string; installs: number }[]
  byPlatform: { platform: string; installs: number }[]
  scopedToDeployTarget?: string | null
}): SummaryBody {
  return {
    summary: 'chmonitor install counts',
    anonymous: true,
    enabled: true,
    scoped_to_deploy_target: input.scopedToDeployTarget ?? null,
    total_installs: input.total,
    by_deploy_target: input.byDeployTarget,
    by_ch_version: input.byChVersion,
    by_ch_flavor: input.byChFlavor,
    by_country: input.byCountry,
    by_platform: input.byPlatform,
    source: 'D1 ping_daily (COUNT DISTINCT of opaque SHA-256 instance id)',
    generated_at: new Date().toISOString(),
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      ...CORS,
    },
  })
}

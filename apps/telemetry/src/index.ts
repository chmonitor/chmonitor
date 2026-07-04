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
// There is no auth: this is a public, write-only ingest. It cannot be read back
// over HTTP — only the project's Cloudflare account can query the dataset.

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
  'access-control-allow-methods': 'POST, OPTIONS',
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

      env.CHM_TELEMETRY_AE.writeDataPoint({
        // index1 — distinct-install key. Count installs with uniqExact(index1).
        indexes: [instanceHash],
        // blob1=kind, blob2=deploy_target, blob3=ch_version
        blobs: ['ping', deployTarget, chVersion],
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
            'INSERT OR IGNORE INTO ping_daily (day, instance_hash, deploy_target, ch_version) VALUES (?, ?, ?, ?)'
          )
            .bind(day, instanceHash, deployTarget, chVersion || null)
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

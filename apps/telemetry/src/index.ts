// chmonitor telemetry collector — the ingest endpoint that CHM_TELEMETRY_ENDPOINT
// points at. Receives the anonymous instance ping (and optional aggregate
// events) emitted by apps/dashboard/src/lib/telemetry and records them to
// Cloudflare Analytics Engine.
//
// Privacy contract (mirrors the dashboard client, defense-in-depth):
//   - Accepts ONLY a closed, validated shape. Unknown fields are ignored.
//   - instance_hash is a SHA-256 hex digest of a random local id — opaque, not
//     reversible to any identity. It is the per-install counter. Optional
//     license_key is the Polar checkout id when CHM_LICENSE_KEY is set (honor
//     system; not a feature gate). It is persisted but never returned by
//     GET /v1/summary.
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

import { TELEMETRY_PAGE } from './page'
import { CH_FLAVORS, DEPLOY_TARGETS } from '@chm/types/telemetry'

export interface Env {
  CHM_TELEMETRY_DB: D1Database
}

const MAX_BODY_BYTES = 2048

const DEPLOY_TARGET_SET = new Set<string>(DEPLOY_TARGETS)
const CH_FLAVOR_SET = new Set<string>(CH_FLAVORS)
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

// ─── CLI telemetry (source=cli) — a SEPARATE tracking stream ─────────────────
// Emitted by rust/ch-monitor-cli (`chm`) and scripts/install.sh. Recorded to the
// cli_daily table, never mixed with the dashboard's ping_daily / events streams.
// Mirror rust/ch-monitor-cli/src/telemetry.rs — keep these in sync.
const CLI_EVENTS = new Set(['cli_install', 'cli_run', 'cli_diagnose'])
const CLI_COMMANDS = new Set([
  'hosts',
  'chart',
  'table',
  'tui',
  'diagnose',
  'install',
  'update',
  '',
])
const ARCHES = new Set(['x86_64', 'aarch64', 'unknown'])

const HEX64 = /^[0-9a-f]{64}$/
const MAJOR_MINOR = /^\d{1,3}\.\d{1,3}$/
// CHM product version (e.g. '0.3.1') — semver-like, 1-3 dot-separated numbers.
const SEMVER = /^\d{1,3}\.\d{1,3}(\.\d{1,5})?$/

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

/** Accept a semver-like CHM version string (e.g. '0.3.1'), else ''. */
function asChmVersion(v: unknown): string {
  return typeof v === 'string' && SEMVER.test(v) ? v : ''
}

/** Accept a Polar checkout / order id (UUID charset), else ''. */
function asLicenseKey(v: unknown): string {
  if (typeof v !== 'string') return ''
  const trimmed = v.trim()
  if (trimmed.length < 8 || trimmed.length > 80) return ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/.test(trimmed)) return ''
  return trimmed
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

    if (req.method === 'GET' && pathname === '/health') {
      return new Response('OK\n', {
        status: 200,
        headers: { 'content-type': 'text/plain', ...CORS },
      })
    }

    if (req.method === 'GET' && pathname === '/') {
      return new Response(TELEMETRY_PAGE, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
          ...CORS,
        },
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
      const deployTarget = asEnum(
        data.deploy_target,
        DEPLOY_TARGET_SET,
        'unknown'
      )
      const chVersion = asVersion(data.ch_version)
      const chFlavor = asEnum(data.ch_flavor, CH_FLAVOR_SET, 'unknown')
      const country =
        typeof data.country === 'string' && COUNTRY_CODE.test(data.country)
          ? data.country.toLowerCase()
          : 'unknown'
      const platform = asEnum(data.platform, PLATFORMS, 'unknown')
      const chmVersion = asChmVersion(data.chm_version)
      // install_place: a separate opaque hash identifying the deployment
      // environment (k8s cluster, Docker host, etc.). Must be a valid SHA-256
      // hex digest — same format as instance_hash.
      const installPlace =
        typeof data.install_place === 'string' && HEX64.test(data.install_place)
          ? data.install_place
          : ''
      const licenseKey = asLicenseKey(data.license_key)

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          `INSERT INTO ping_daily (day, instance_hash, deploy_target, ch_version, ch_flavor, country, platform, chm_version, install_place, license_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(day, instance_hash) DO UPDATE SET
             deploy_target = CASE
               WHEN ping_daily.deploy_target IN ('unknown', '')
                 AND excluded.deploy_target NOT IN ('unknown', '')
               THEN excluded.deploy_target ELSE ping_daily.deploy_target END,
             ch_version = COALESCE(NULLIF(ping_daily.ch_version, ''), excluded.ch_version),
             ch_flavor = CASE
               WHEN COALESCE(ping_daily.ch_flavor, 'unknown') IN ('unknown', '')
                 AND COALESCE(excluded.ch_flavor, 'unknown') NOT IN ('unknown', '')
               THEN excluded.ch_flavor
               ELSE COALESCE(NULLIF(ping_daily.ch_flavor, ''), excluded.ch_flavor) END,
             country = CASE
               WHEN COALESCE(ping_daily.country, 'unknown') IN ('unknown', '')
               THEN excluded.country ELSE ping_daily.country END,
             platform = CASE
               WHEN COALESCE(ping_daily.platform, 'unknown') IN ('unknown', '')
               THEN excluded.platform ELSE ping_daily.platform END,
             chm_version = COALESCE(NULLIF(ping_daily.chm_version, ''), excluded.chm_version),
             install_place = COALESCE(NULLIF(ping_daily.install_place, ''), excluded.install_place),
             license_key = COALESCE(NULLIF(ping_daily.license_key, ''), excluded.license_key)`
        )
          .bind(
            day,
            instanceHash,
            deployTarget,
            chVersion || null,
            chFlavor || null,
            country || null,
            platform || null,
            chmVersion || null,
            installPlace || null,
            licenseKey || null
          )
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
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
        DEPLOY_TARGET_SET,
        'unknown'
      )
      const chVersion = asVersion(props.ch_version)
      const chFlavor = asEnum(props.ch_flavor, CH_FLAVOR_SET, 'unknown')

      // Dedupe per (day, event, deploy_target, ch_version, ch_flavor): no
      // instance_hash is sent here (unlike /v1/ping), so this coarser tuple
      // is the bound — see migrations/0004_dedupe_events.sql.
      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO events (day, event, deploy_target, ch_version, ch_flavor) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(day, event, deployTarget, chVersion || null, chFlavor || null)
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
      return noContent()
    }

    if (pathname === '/v1/cli') {
      // Separate CLI tracking stream (source=cli). Closed, validated shape;
      // unknown fields ignored. install_id is an opaque SHA-256 hex of a random
      // local UUID — for one-shot installs (install.sh) it may be ephemeral.
      const installId = data.install_id
      if (typeof installId !== 'string' || !HEX64.test(installId)) {
        return bad(400, 'invalid install_id')
      }
      const event =
        typeof data.event === 'string' && CLI_EVENTS.has(data.event)
          ? data.event
          : ''
      if (!event) return bad(400, 'invalid event')
      const command = asEnum(data.command, CLI_COMMANDS, '')
      const cliVersion = asChmVersion(data.cli_version)
      const os = asEnum(data.os, PLATFORMS, 'unknown')
      const arch = asEnum(data.arch, ARCHES, 'unknown')
      const licenseKey = asLicenseKey(data.license_key)

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO cli_daily (day, install_id, event, command, cli_version, os, arch, license_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            day,
            installId,
            event,
            command,
            cliVersion || null,
            os || null,
            arch || null,
            licenseKey || null
          )
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
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
// license_key is persisted on ping/cli rows but never returned here.
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
    targetParam && DEPLOY_TARGET_SET.has(targetParam) ? targetParam : null

  // Same WHERE clause for total + by-version when scoped; by_deploy_target
  // stays global so the breakdown is always visible.
  const where = scoped ? 'WHERE deploy_target = ?' : ''
  const installPlacesWhere = scoped
    ? 'WHERE deploy_target = ? AND install_place IS NOT NULL'
    : 'WHERE install_place IS NOT NULL'
  const stmt = (sql: string) =>
    scoped
      ? env.CHM_TELEMETRY_DB!.prepare(sql).bind(scoped)
      : env.CHM_TELEMETRY_DB!.prepare(sql)

  try {
    const [
      totalRow,
      byTarget,
      byVersion,
      byFlavor,
      byCountry,
      byPlatform,
      byChmVersion,
      totalPlaces,
    ] = await Promise.all([
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
        `SELECT COALESCE(NULLIF(TRIM(ch_version), ''), 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(NULLIF(TRIM(ch_flavor), ''), 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(country, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC LIMIT 10`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(platform, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(NULLIF(TRIM(chm_version), ''), 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COUNT(DISTINCT install_place) AS n FROM ping_daily ${installPlacesWhere}`
      ).first<{ n: number }>(),
    ])

    const byDeployTarget: Record<string, number> = {}
    for (const r of byTarget.results ?? []) {
      byDeployTarget[r.deploy_target] = Number(r.n)
    }

    const cli = await cliSummary(env)

    return json(
      summaryShape({
        cli,
        total: Number(totalRow?.n ?? 0),
        totalPlaces: Number(totalPlaces?.n ?? 0),
        byDeployTarget,
        byChVersion: (byVersion.results ?? []).map((r) => ({
          ch_version: r.v,
          installs: Number(r.n),
        })),
        byChFlavor: (byFlavor.results ?? [])
          .map((r) => ({
            ch_flavor: r.v,
            installs: Number(r.n),
          }))
          // Empty / unknown mean "not reported" — not a flavor. The chart
          // should only list oss / altinity / cloud.
          .filter(
            (r) => CH_FLAVOR_SET.has(r.ch_flavor) && r.ch_flavor !== 'unknown'
          ),
        byCountry: (byCountry.results ?? []).map((r) => ({
          country: r.v,
          installs: Number(r.n),
        })),
        byPlatform: (byPlatform.results ?? []).map((r) => ({
          platform: r.v,
          installs: Number(r.n),
        })),
        byChmVersion: (byChmVersion.results ?? []).map((r) => ({
          chm_version: r.v,
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

interface CliSummary {
  installs: number
  active_users: number
  by_command: { command: string; runs: number }[]
  by_cli_version: { cli_version: string; installs: number }[]
  by_os: { os: string; installs: number }[]
  by_arch: { arch: string; installs: number }[]
  installs_over_time: { day: string; installs: number }[]
}

const EMPTY_CLI: CliSummary = {
  installs: 0,
  active_users: 0,
  by_command: [],
  by_cli_version: [],
  by_os: [],
  by_arch: [],
  installs_over_time: [],
}

// Aggregate-only CLI stats from cli_daily. Every number is a COUNT/COUNT
// DISTINCT of the opaque install_id — no per-install rows, IPs, or free-text
// are exposed. Best-effort: any query failure degrades to zeros.
async function cliSummary(env: Env): Promise<CliSummary> {
  try {
    const [installs, active, byCommand, byVersion, byOs, byArch, overTime] =
      await Promise.all([
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COUNT(*) AS n FROM cli_daily WHERE event = 'cli_install'"
        ).first<{ n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COUNT(DISTINCT install_id) AS n FROM cli_daily WHERE event != 'cli_install'"
        ).first<{ n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT command AS v, COUNT(*) AS n FROM cli_daily WHERE event != 'cli_install' AND command != '' GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COALESCE(cli_version, 'unknown') AS v, COUNT(DISTINCT install_id) AS n FROM cli_daily GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COALESCE(os, 'unknown') AS v, COUNT(DISTINCT install_id) AS n FROM cli_daily GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COALESCE(arch, 'unknown') AS v, COUNT(DISTINCT install_id) AS n FROM cli_daily GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT day, COUNT(*) AS n FROM cli_daily WHERE event = 'cli_install' AND day >= date('now', '-30 days') GROUP BY day ORDER BY day ASC"
        ).all<{ day: string; n: number }>(),
      ])

    return {
      installs: Number(installs?.n ?? 0),
      active_users: Number(active?.n ?? 0),
      by_command: (byCommand.results ?? []).map((r) => ({
        command: r.v,
        runs: Number(r.n),
      })),
      by_cli_version: (byVersion.results ?? []).map((r) => ({
        cli_version: r.v,
        installs: Number(r.n),
      })),
      by_os: (byOs.results ?? []).map((r) => ({
        os: r.v,
        installs: Number(r.n),
      })),
      by_arch: (byArch.results ?? []).map((r) => ({
        arch: r.v,
        installs: Number(r.n),
      })),
      installs_over_time: (overTime.results ?? []).map((r) => ({
        day: r.day,
        installs: Number(r.n),
      })),
    }
  } catch {
    return EMPTY_CLI
  }
}

interface SummaryBody {
  summary: string
  anonymous: boolean
  enabled: boolean
  scoped_to_deploy_target: string | null
  total_installs: number
  total_places: number
  by_deploy_target: Record<string, number>
  by_ch_version: { ch_version: string; installs: number }[]
  by_ch_flavor: { ch_flavor: string; installs: number }[]
  by_country: { country: string; installs: number }[]
  by_platform: { platform: string; installs: number }[]
  by_chm_version: { chm_version: string; installs: number }[]
  cli: CliSummary
  source: string
  generated_at: string
}

function summaryShape(input: {
  total: number
  totalPlaces?: number
  byDeployTarget: Record<string, number>
  byChVersion: { ch_version: string; installs: number }[]
  byChFlavor: { ch_flavor: string; installs: number }[]
  byCountry: { country: string; installs: number }[]
  byPlatform: { platform: string; installs: number }[]
  byChmVersion?: { chm_version: string; installs: number }[]
  cli?: CliSummary
  scopedToDeployTarget?: string | null
}): SummaryBody {
  return {
    summary: 'chmonitor install counts',
    anonymous: true,
    enabled: true,
    scoped_to_deploy_target: input.scopedToDeployTarget ?? null,
    total_installs: input.total,
    total_places: input.totalPlaces ?? 0,
    by_deploy_target: input.byDeployTarget,
    by_ch_version: input.byChVersion,
    by_ch_flavor: input.byChFlavor,
    by_country: input.byCountry,
    by_platform: input.byPlatform,
    by_chm_version: input.byChmVersion ?? [],
    cli: input.cli ?? EMPTY_CLI,
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

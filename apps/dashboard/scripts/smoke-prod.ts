#!/usr/bin/env bun

/**
 * Anonymous production smoke: sweeps every dashboard page, every chart and
 * table config the DEPLOYED worker knows about, health endpoints, static
 * assets, and the anonymous write gate. Classification lives in
 * smoke-prod-classify.ts.
 *
 *   bun scripts/smoke-prod.ts [--base-url URL] [--host 0] [--json FILE]
 *   SMOKE_BASE_URL=... bun scripts/smoke-prod.ts
 *
 * Exit: 0 = no failing findings, 1 = failing findings, 2 = harness error.
 */

import {
  classify,
  hostStatusDown,
  type Probe,
  type ProbeKind,
  summarize,
} from './smoke-prod-classify'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}

const BASE_URL = (
  flag('base-url') ??
  process.env.SMOKE_BASE_URL ??
  'https://dash.chmonitor.dev'
).replace(/\/$/, '')
const HOST = flag('host') ?? '0'
const JSON_FILE = flag('json')
const CONCURRENCY = 4
const TIMEOUT_MS = 20_000

// Writes an anonymous visitor must not be able to perform in cloud mode.
const ANON_WRITES: Array<[string, string]> = [
  ['POST', '/api/v1/auth/api-key'],
  ['POST', '/api/v1/actions'],
  ['PUT', '/api/v1/health/alert-config'],
  ['POST', '/api/v1/health/custom-rules'],
  ['POST', '/api/v1/conversations'],
  ['POST', '/api/v1/user-connections'],
]

async function probe(
  kind: ProbeKind,
  name: string,
  path: string,
  method = 'GET',
  expect?: Probe['expect']
): Promise<Probe> {
  const start = performance.now()
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      // Pages may legitimately redirect (/ -> /overview, moved routes); an API
      // redirect is itself suspicious, so keep it visible as a non-2xx status.
      redirect: kind === 'page' ? 'follow' : 'manual',
      headers:
        method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.text()
    return {
      kind,
      name,
      method,
      path,
      status: res.status,
      ms: Math.round(performance.now() - start),
      body,
      expect,
    }
  } catch (e) {
    return {
      kind,
      name,
      method,
      path,
      status: 0,
      ms: Math.round(performance.now() - start),
      body: '',
      error:
        (e as { name?: string })?.name === 'TimeoutError'
          ? `timeout ${TIMEOUT_MS}ms`
          : String(e),
      expect,
    }
  }
}

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

// The page list is the Cypress render sweep, which a parity test keeps equal to
// the route files.
function dashboardRoutes(): string[] {
  const file = fileURLToPath(
    new URL('../cypress/e2e/page-render-sweep.cy.ts', import.meta.url)
  )
  const match = readFileSync(file, 'utf8').match(
    /const DASHBOARD_ROUTES = \[([\s\S]*?)\] as const/
  )
  if (!match) throw new Error('could not parse DASHBOARD_ROUTES')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

// Ask the deployed worker for its own registry via the 404 body, so the sweep
// covers exactly what is live rather than what this checkout has.
async function discover(kind: 'charts' | 'tables'): Promise<string[]> {
  const p = await probe(
    kind === 'charts' ? 'chart' : 'table',
    'discover',
    `/api/v1/${kind}/__smoke_unknown__?hostId=${HOST}`
  )
  const key = kind === 'charts' ? 'availableCharts' : 'availableTables'
  const list = (
    JSON.parse(p.body) as { error?: { details?: Record<string, string> } }
  )?.error?.details?.[key]
  if (!list) throw new Error(`could not discover ${kind}: HTTP ${p.status}`)
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function main() {
  const started = Date.now()
  const hostStatus = await probe(
    'health',
    'host-status',
    `/api/v1/host-status?hostId=${HOST}`
  )
  const upstreamDown = hostStatusDown(hostStatus)
  const [charts, tables] = await Promise.all([
    discover('charts'),
    discover('tables'),
  ])

  const overview = await probe('page', '/overview', `/overview?host=${HOST}`)
  const assets = [
    ...new Set(overview.body.match(/\/assets\/[\w.-]+\.(?:js|css)/g) ?? []),
  ].slice(0, 10)
  const ogImage = overview.body.match(
    /property="og:image" content="([^"]+)"/
  )?.[1]

  type Job = [ProbeKind, string, string, string?, Probe['expect']?]
  const jobs: Job[] = [
    ['health', '/api/health', '/api/health'],
    ['health', '/healthz', '/healthz'],
    ['health', '/api/v1/hosts', '/api/v1/hosts'],
    ['page', '/', '/'],
    ...dashboardRoutes()
      .filter((r) => r !== '/overview')
      .map((r): Job => ['page', r, `${r}?host=${HOST}`]),
    ...assets.map((a): Job => ['asset', a, a]),
    ...(ogImage
      ? [['asset', 'og:image', ogImage.replace(BASE_URL, '')] as Job]
      : []),
    ...ANON_WRITES.map(
      ([m, path]): Job => ['auth', `${m} ${path}`, path, m, 'unauthorized']
    ),
    ...charts.map(
      (c): Job => ['chart', c, `/api/v1/charts/${c}?hostId=${HOST}`]
    ),
    ...tables.map(
      (t): Job => ['table', t, `/api/v1/tables/${t}?hostId=${HOST}`]
    ),
  ]
  const probes = [overview, ...(await pool(jobs, (j) => probe(...j)))]
  const results = probes.map((p) => classify(p, upstreamDown))
  const findings = summarize(results)
  const failing = findings.filter((f) => f.severity === 'fail')

  const counts: Record<string, number> = {}
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1
  const report = {
    baseUrl: BASE_URL,
    host: HOST,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    upstreamDown,
    hostStatus: {
      status: hostStatus.status,
      body: hostStatus.body.slice(0, 200),
    },
    probes: probes.length,
    discovered: { charts: charts.length, tables: tables.length },
    counts,
    ok: failing.length === 0,
    findings,
  }
  if (JSON_FILE)
    writeFileSync(JSON_FILE, `${JSON.stringify(report, null, 2)}\n`)

  console.log(
    `Smoke ${BASE_URL} host=${HOST}: ${probes.length} probes in ${report.durationMs}ms`
  )
  console.log(
    `  ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}  (charts=${charts.length} tables=${tables.length})`
  )
  for (const f of findings) {
    console.log(
      `${f.severity === 'fail' ? 'FAIL' : 'WARN'} ${f.title}${f.count > 1 ? ` [x${f.count}]` : ''}`
    )
    if (f.count > 1)
      for (const e of f.examples) console.log(`       - ${e.slice(0, 160)}`)
  }
  console.log(
    failing.length === 0
      ? 'RESULT: PASS'
      : `RESULT: FAIL (${failing.length} finding(s))`
  )
  process.exit(failing.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('harness error:', e)
  process.exit(2)
})

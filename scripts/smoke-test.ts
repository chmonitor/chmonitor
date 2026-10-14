/**
 * Deployment Smoke Test & Health Report
 *
 * Tests all chart/table API endpoints across all hosts on a live deployment.
 * Produces a categorized health report with actionable items.
 *
 * Run: bun scripts/smoke-test.ts [--base-url URL] [--json] [--verbose]
 *
 * Exit codes: 0=all pass, 1=failures found, 2=test error
 */

const args = process.argv.slice(2)
const BASE_URL =
  args.find((a) => a.startsWith('--base-url='))?.split('=')[1] ||
  (args.indexOf('--base-url') !== -1
    ? args[args.indexOf('--base-url') + 1]
    : undefined) ||
  'https://clickhouse.duyet.net'
const JSON_OUTPUT = args.includes('--json')
const _VERBOSE = args.includes('--verbose')
const API_KEY_SECRET =
  args.find((a) => a.startsWith('--api-key-secret='))?.split('=')[1] ||
  (args.indexOf('--api-key-secret') !== -1
    ? args[args.indexOf('--api-key-secret') + 1]
    : undefined) ||
  process.env.CHM_API_KEY_SECRET

/** Bearer token for authenticated requests (minted via /api/v1/auth/api-key). */
let authToken = ''

type ErrorCategory =
  | 'auth'
  | 'table_not_found'
  | 'sql_error'
  | 'timeout'
  | 'network'
  | 'empty'
  | 'unknown'

interface TestResult {
  chart: string
  hostId: number
  success: boolean
  rows: number
  status?: string
  error?: string
  category?: ErrorCategory
  missingTables?: string[]
  durationMs: number
}

interface HostInfo {
  id: number
  name: string
  url: string
  version?: string
  status: 'online' | 'offline'
  chartsOk: number
  chartsFail: number
  chartsEmpty: number
}

interface CategoryGroup {
  category: ErrorCategory
  label: string
  icon: string
  results: TestResult[]
}

async function fetchJSON(
  url: string,
  init?: RequestInit
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }
  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  return { status: res.status, json: await res.json() }
}

function categorizeError(error: string): ErrorCategory {
  const lower = error.toLowerCase()
  if (
    lower.includes('authentication failed') ||
    lower.includes('password is incorrect') ||
    lower.includes('access') ||
    lower.includes('permission')
  )
    return 'auth'
  if (
    lower.includes('table') &&
    (lower.includes('not exist') ||
      lower.includes('missing') ||
      lower.includes('unknown table expression'))
  )
    return 'table_not_found'
  if (lower.includes('syntax error') || lower.includes('failed at position'))
    return 'sql_error'
  if (lower.includes('timed out') || lower.includes('timeout')) return 'timeout'
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('network')
  )
    return 'network'
  return 'unknown'
}

function extractMissingTables(error: string): string[] {
  const matches = error.match(/system\.\w+(?:_log)?|INFORMATION_SCHEMA\.\w+/gi)
  return matches ? [...new Set(matches)] : []
}

async function discoverHosts(): Promise<HostInfo[]> {
  const hosts: HostInfo[] = []
  try {
    const { json: d } = await fetchJSON(`${BASE_URL}/api/v1/hosts`)
    if (d.success && Array.isArray(d.data)) {
      for (const h of d.data) {
        hosts.push({
          id: h.id ?? hosts.length,
          name:
            h.name ||
            h.host?.split('//')[1]?.split('.')[0] ||
            `Host ${hosts.length}`,
          url: h.host || '',
          status: 'online',
          chartsOk: 0,
          chartsFail: 0,
          chartsEmpty: 0,
        })
      }
    }
  } catch {
    /* fallback below */
  }

  // Fallback: probe hostId 0-9
  if (hosts.length === 0) {
    for (let i = 0; i < 10; i++) {
      try {
        const { json: r } = await fetchJSON(
          `${BASE_URL}/api/v1/data?hostId=${i}&sql=SELECT+1`
        )
        if (!r.success) break
        const host = r.metadata?.host || ''
        hosts.push({
          id: i,
          name: host.split('//')[1]?.split('.')[0] || `Host ${i}`,
          url: host,
          status: 'online',
          chartsOk: 0,
          chartsFail: 0,
          chartsEmpty: 0,
        })
      } catch {
        break
      }
    }
  }

  return hosts
}

async function getHostVersion(hostId: number): Promise<string | undefined> {
  try {
    const { json: d } = await fetchJSON(
      `${BASE_URL}/api/v1/data?hostId=${hostId}&sql=SELECT+version()`
    )
    if (d.success && Array.isArray(d.data) && d.data[0]) {
      return Object.values(d.data[0])[0] as string
    }
  } catch {
    /* ignore */
  }
  return undefined
}

async function getChartList(): Promise<string[]> {
  const { json: d } = await fetchJSON(
    `${BASE_URL}/api/v1/charts/nonexistent?hostId=0`
  )
  const list = d?.error?.details?.availableCharts as string
  if (!list) throw new Error('Could not fetch chart list from API')
  return list.split(', ').map((s: string) => s.trim())
}

async function mintAuthToken(): Promise<void> {
  if (!API_KEY_SECRET) return
  try {
    const { status, json } = await fetchJSON(
      `${BASE_URL}/api/v1/auth/api-key`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'smoke-test', days: 1 }),
      }
    )
    const token = (json as { data?: { apiKey?: string } })?.data?.apiKey ?? ''
    if (status === 200 && token.startsWith('chm_')) {
      authToken = token
      if (!JSON_OUTPUT) {
        console.log(`  🔑 Authenticated: minted ${token.slice(0, 10)}…\n`)
      }
    } else if (!JSON_OUTPUT) {
      console.log(
        `  ⚠️  Token mint failed (HTTP ${status}) — proceeding unauthenticated\n`
      )
    }
  } catch {
    if (!JSON_OUTPUT) {
      console.log('  ⚠️  Token mint failed — proceeding unauthenticated\n')
    }
  }
}

async function testChart(chart: string, hostId: number): Promise<TestResult> {
  const start = Date.now()
  try {
    const { json: d } = await fetchJSON(
      `${BASE_URL}/api/v1/charts/${chart}?hostId=${hostId}`
    )
    const success = d.success === true
    const rows = d.metadata?.rows ?? 0
    const status = d.metadata?.status
    const error = d.error?.message

    // Categorize empty results
    if (success && rows === 0) {
      return {
        chart,
        hostId,
        success: true,
        rows: 0,
        status,
        category: 'empty',
        durationMs: Date.now() - start,
      }
    }

    if (success) {
      return {
        chart,
        hostId,
        success: true,
        rows,
        status,
        durationMs: Date.now() - start,
      }
    }

    const category = categorizeError(error || '')
    return {
      chart,
      hostId,
      success: false,
      rows: 0,
      status,
      error: error?.slice(0, 150),
      category,
      missingTables:
        category === 'table_not_found'
          ? extractMissingTables(error || '')
          : undefined,
      durationMs: Date.now() - start,
    }
  } catch (err: any) {
    const msg = err.message ?? String(err)
    const category = categorizeError(msg)
    return {
      chart,
      hostId,
      success: false,
      rows: 0,
      error: msg.slice(0, 150),
      category,
      durationMs: Date.now() - start,
    }
  }
}

const CATEGORY_META: Record<ErrorCategory, { label: string; icon: string }> = {
  auth: { label: 'Authentication Failed', icon: '🔐' },
  table_not_found: { label: 'Missing Tables', icon: '📋' },
  sql_error: { label: 'SQL Syntax Errors', icon: '🐛' },
  timeout: { label: 'Timeouts', icon: '⏱️' },
  network: { label: 'Network Errors', icon: '🌐' },
  empty: { label: 'Empty Data (no rows)', icon: '📭' },
  unknown: { label: 'Unknown Errors', icon: '❓' },
}

function renderReport(
  hosts: HostInfo[],
  results: TestResult[],
  _charts: string[]
) {
  const W = 70

  console.log(`\n${'═'.repeat(W)}`)
  console.log(
    `  DEPLOYMENT HEALTH REPORT — ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`
  )
  console.log(`  ${BASE_URL}`)
  console.log('═'.repeat(W))

  console.log(`\n  HOST STATUS`)
  console.log(`  ${'─'.repeat(W - 4)}`)

  for (const host of hosts) {
    const hostResults = results.filter((r) => r.hostId === host.id)
    host.chartsOk = hostResults.filter(
      (r) => r.success && r.category !== 'empty'
    ).length
    host.chartsEmpty = hostResults.filter(
      (r) => r.success && r.category === 'empty'
    ).length
    host.chartsFail = hostResults.filter((r) => !r.success).length

    const totalCharts = hostResults.length
    const healthPct = totalCharts
      ? Math.round(((host.chartsOk + host.chartsEmpty) / totalCharts) * 100)
      : 0
    const bar = renderBar(healthPct, 20)
    const version = host.version || '?'

    console.log(
      `  H${host.id} ${host.name.padEnd(16)} ${bar} ${String(healthPct).padStart(3)}%  v${version}`
    )
    console.log(
      `     ${host.url}  (${totalCharts} charts: ${host.chartsOk} ok, ${host.chartsEmpty} empty, ${host.chartsFail} fail)`
    )
  }

  const failures = results.filter((r) => !r.success)

  if (failures.length > 0) {
    const groups: CategoryGroup[] = []
    const seen = new Set<ErrorCategory>()
    for (const r of failures) {
      const cat = r.category || 'unknown'
      if (!seen.has(cat)) {
        seen.add(cat)
        groups.push({
          category: cat,
          ...CATEGORY_META[cat],
          results: [],
        })
      }
      groups.find((g) => g.category === cat)!.results.push(r)
    }

    console.log(`\n  FAILURES BY CATEGORY`)
    console.log(`  ${'─'.repeat(W - 4)}`)

    for (const group of groups) {
      console.log(`\n  ${group.icon} ${group.label} (${group.results.length})`)

      for (const r of group.results) {
        const hostTag = `H${r.hostId}`
        if (group.category === 'table_not_found') {
          const tables = r.missingTables?.join(', ') || '(unknown)'
          console.log(`    ❌ ${hostTag} ${r.chart}: missing ${tables}`)
        } else {
          const maxErrLen = W - hostTag.length - r.chart.length - 8
          const errShort = (r.error || '')
            .slice(0, Math.max(40, maxErrLen))
            .split('\n')[0]
          console.log(`    ❌ ${hostTag} ${r.chart}: ${errShort}`)
        }
      }
    }
  }

  const emptyResults = results.filter(
    (r) => r.success && r.category === 'empty'
  )
  if (emptyResults.length > 0) {
    console.log(`\n  📭 EMPTY DATA (chart OK, 0 rows)`)
    console.log(`  ${'─'.repeat(W - 4)}`)

    for (const host of hosts) {
      const hostEmpty = emptyResults.filter((r) => r.hostId === host.id)
      if (hostEmpty.length === 0) continue
      const names = hostEmpty.map((r) => r.chart).join(', ')
      console.log(
        `  H${host.id} ${host.name}: ${hostEmpty.length} empty — ${wrapList(names, W - 30)}`
      )
    }
  }

  const allMissingTables = new Map<string, Set<number>>()
  for (const r of results.filter((r) => r.category === 'table_not_found')) {
    for (const t of r.missingTables || []) {
      if (!allMissingTables.has(t)) allMissingTables.set(t, new Set())
      allMissingTables.get(t)!.add(r.hostId)
    }
  }
  if (allMissingTables.size > 0) {
    console.log(`\n  📋 TABLES TO ENABLE`)
    console.log(`  ${'─'.repeat(W - 4)}`)
    for (const [table, hostIds] of allMissingTables) {
      const hostsStr = [...hostIds].map((h) => `H${h}`).join(', ')
      console.log(`  • ${table} — missing on ${hostsStr}`)
    }
  }

  const totalTests = results.length
  const passed = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  const okWithData = results.filter(
    (r) => r.success && r.category !== 'empty'
  ).length

  console.log(`\n${'═'.repeat(W)}`)
  console.log(
    `  TOTAL: ${totalTests} tests | ✅ ${okWithData} data | 📭 ${passed - okWithData} empty | ❌ ${failed} fail`
  )

  if (failed === 0) {
    console.log(`  ✅ All charts operational on all ${hosts.length} hosts.`)
  } else {
    console.log(`  ❌ ${failed} charts need attention.`)
  }
  console.log(`${'═'.repeat(W)}\n`)
}

function renderBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width)
  const empty = width - filled
  const bar =
    pct >= 90
      ? '█'.repeat(filled) + '░'.repeat(empty)
      : pct >= 70
        ? '▓'.repeat(filled) + '░'.repeat(empty)
        : '▒'.repeat(filled) + '░'.repeat(empty)
  return `[${bar}]`
}

function wrapList(items: string, maxLen: number): string {
  if (items.length <= maxLen) return items
  return `${items.slice(0, maxLen - 3)}...`
}

async function main() {
  await mintAuthToken()

  const hosts = await discoverHosts()
  if (hosts.length === 0) {
    console.error('No hosts found. Is the deployment accessible?')
    process.exit(2)
  }

  const [charts, ...versions] = await Promise.all([
    getChartList(),
    ...hosts.map((h) => getHostVersion(h.id)),
  ])
  for (let i = 0; i < hosts.length; i++) {
    hosts[i].version = versions[i]
  }

  const promises: Promise<TestResult>[] = []
  for (const host of hosts) {
    for (const chart of charts) {
      promises.push(testChart(chart, host.id))
    }
  }
  const results = await Promise.all(promises)

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          timestamp: new Date().toISOString(),
          hosts: hosts.map((h) => ({
            id: h.id,
            name: h.name,
            url: h.url,
            version: h.version,
            chartsOk: h.chartsOk,
            chartsFail: h.chartsFail,
            chartsEmpty: h.chartsEmpty,
          })),
          totalTests: results.length,
          passed: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          categories: Object.fromEntries(
            (Object.keys(CATEGORY_META) as ErrorCategory[]).map((cat) => [
              cat,
              results.filter((r) => r.category === cat && !r.success).length,
            ])
          ),
          results,
        },
        null,
        2
      )
    )
  } else {
    renderReport(hosts, results, charts)
  }

  const failed = results.filter((r) => !r.success).length
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Smoke test failed:', err)
  process.exit(2)
})

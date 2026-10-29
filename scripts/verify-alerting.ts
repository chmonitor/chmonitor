#!/usr/bin/env bun

/**
 * End-to-end check for the alerting pipeline. Run after any change to
 * lib/alerting, lib/health/adapters, lib/health/sweep, alert routing, channel
 * providers, or rule SQL:
 *
 *   bun scripts/verify-alerting.ts
 *
 * 1. Starts a scratch `clickhouse server` (or uses CHM_VERIFY_CLICKHOUSE_URL).
 * 2. Runs every builtin rule SQL, every remediation diagnostic, and the batched
 *    sweep statement under enable_analyzer=0 and =1.
 * 3. Drives the real sweep dispatcher (firing, reminder, recovery) into a local
 *    HTTPS capture server for every webhook format, a native Matrix route and an
 *    ntfy route, and asserts each request.
 * 4. Runs the focused alerting test suites.
 *
 * Exits non-zero on the first failing step. See
 * docs/knowledge/alerting-validation.md.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const DASHBOARD = join(ROOT, 'apps/dashboard')
// Child test runs get the caller's env, not the overrides the delivery step sets.
const CALLER_ENV = { ...process.env }
const CLICKHOUSE_BIN =
  process.env.CHM_VERIFY_CLICKHOUSE_BIN || '/usr/bin/clickhouse'

Bun.plugin({
  name: 'cloudflare-workers-shim',
  setup(build) {
    build.module('cloudflare:workers', () => ({
      exports: { env: process.env },
      loader: 'object',
    }))
  },
})

const tempDirs: string[] = []
let clickhouse: ReturnType<typeof spawn> | null = null

function cleanup(): void {
  clickhouse?.kill('SIGKILL')
  clickhouse = null
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
}

function fail(message: string): never {
  console.error(`\nFAIL: ${message}`)
  cleanup()
  process.exit(1)
}

process.on('SIGINT', () => fail('interrupted'))

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer()
    srv.once('error', ko)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() =>
        typeof addr === 'object' && addr
          ? ok(addr.port)
          : ko(new Error('no port'))
      )
    })
  })
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => r[i].length))
  )
  for (const row of rows)
    console.log(row.map((c, i) => c.padEnd(widths[i])).join('  '))
}

// ---------------------------------------------------------------- ClickHouse

interface ChEndpoint {
  url: string
  headers: Record<string, string>
  scratch: boolean
}

async function startClickHouse(): Promise<ChEndpoint> {
  const external = process.env.CHM_VERIFY_CLICKHOUSE_URL
  if (external) {
    const u = new URL(external)
    const headers: Record<string, string> = {}
    if (u.username)
      headers['X-ClickHouse-User'] = decodeURIComponent(u.username)
    if (u.password) headers['X-ClickHouse-Key'] = decodeURIComponent(u.password)
    u.username = ''
    u.password = ''
    console.log(`ClickHouse: ${u.origin} (CHM_VERIFY_CLICKHOUSE_URL)`)
    return { url: u.origin, headers, scratch: false }
  }

  const dir = mkdtempSync(join(tmpdir(), 'chm-verify-ch-'))
  tempDirs.push(dir)
  const [http, tcp, mysql, postgres, interserver] = await Promise.all(
    Array.from({ length: 5 }, freePort)
  )
  const logTable = (name: string) =>
    `<${name}><database>system</database><table>${name}</table><flush_interval_milliseconds>500</flush_interval_milliseconds></${name}>`
  writeFileSync(
    join(dir, 'config.xml'),
    `<clickhouse>
  ${['query_log', 'part_log', 'text_log', 'error_log', 'metric_log', 'asynchronous_metric_log', 'backup_log'].map(logTable).join('\n  ')}
  <users><default><password></password><networks><ip>127.0.0.1</ip><ip>::1</ip></networks><profile>default</profile><quota>default</quota><access_management>1</access_management></default></users>
  <profiles><default></default></profiles>
  <quotas><default></default></quotas>
</clickhouse>`
  )
  clickhouse = spawn(
    CLICKHOUSE_BIN,
    [
      'server',
      `--config-file=${dir}/config.xml`,
      '--',
      `--path=${dir}/`,
      `--tmp_path=${dir}/tmp/`,
      `--user_files_path=${dir}/user_files/`,
      `--format_schema_path=${dir}/format_schemas/`,
      `--http_port=${http}`,
      `--tcp_port=${tcp}`,
      `--mysql_port=${mysql}`,
      `--postgresql_port=${postgres}`,
      `--interserver_http_port=${interserver}`,
      '--listen_host=127.0.0.1',
      `--logger.log=${dir}/server.log`,
      `--logger.errorlog=${dir}/server.err.log`,
      '--logger.console=0',
    ],
    { cwd: dir, stdio: 'ignore' }
  )
  clickhouse.once('exit', (code) => {
    if (clickhouse)
      fail(`clickhouse server exited early (code ${code}); log in ${dir}`)
  })
  const url = `http://127.0.0.1:${http}`
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/ping`)).ok) {
        console.log(`ClickHouse: scratch server on ${url} (data dir ${dir})`)
        return { url, headers: {}, scratch: true }
      }
    } catch {}
    await Bun.sleep(250)
  }
  fail('clickhouse server did not answer /ping within 30s')
}

async function chQuery(
  ch: ChEndpoint,
  sql: string,
  settings: Record<string, string | number> = {}
): Promise<{ ok: boolean; text: string }> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(settings)) params.set(k, String(v))
  const res = await fetch(`${ch.url}/?${params}`, {
    method: 'POST',
    headers: ch.headers,
    body: sql,
  })
  return { ok: res.ok, text: await res.text() }
}

async function verifyRuleSql(ch: ChEndpoint): Promise<void> {
  const { BUILTIN_RULES } = await import(
    `${DASHBOARD}/src/lib/alerting/builtin-rules.ts`
  )
  const { buildBatchedKpiSql, partitionRulesForSweep } = await import(
    `${DASHBOARD}/src/lib/health/batch-kpi.ts`
  )
  const { isRuleEnabled } = await import(
    `${DASHBOARD}/src/lib/health/sweep/suppression.ts`
  )
  const { buildMvFailedCountSQL, buildMvStalenessSQL } = await import(
    `${DASHBOARD}/src/lib/alerting/mv-refresh-staleness.ts`
  )
  const { buildRegressionSQL } = await import(
    `${DASHBOARD}/src/lib/alerting/slow-query-regression.ts`
  )

  // A fresh server creates its *_log tables lazily: populate them first.
  // Never write to a server the caller pointed us at.
  for (const sql of ch.scratch
    ? [
        'SELECT 1',
        'CREATE TABLE IF NOT EXISTS default.chm_verify (n UInt64) ENGINE = MergeTree ORDER BY n',
        'INSERT INTO default.chm_verify SELECT number FROM numbers(10)',
        'INSERT INTO default.chm_verify SELECT number FROM numbers(10)',
        'OPTIMIZE TABLE default.chm_verify FINAL',
        'SYSTEM FLUSH LOGS',
      ]
    : []) {
    const res = await chQuery(ch, sql)
    if (!res.ok) fail(`scratch warm-up failed on "${sql}": ${res.text}`)
  }

  const tablesRes = await chQuery(
    ch,
    "SELECT concat(database, '.', name) FROM system.tables WHERE database = 'system' FORMAT TSV"
  )
  if (!tablesRes.ok) fail(`system.tables probe failed: ${tablesRes.text}`)
  const tables = new Set(tablesRes.text.split('\n').filter(Boolean))
  const version = (await chQuery(ch, 'SELECT version() FORMAT TSV')).text.trim()
  console.log(`ClickHouse version ${version}, ${tables.size} system tables\n`)

  type Rule = (typeof BUILTIN_RULES)[number]
  const missingTable = (rule: Rule) =>
    rule.optional === true && !!rule.tableCheck && !tables.has(rule.tableCheck)

  const statements: {
    name: string
    sql: string
    settings?: Record<string, string | number>
    skip?: string
  }[] = []
  for (const rule of BUILTIN_RULES as readonly Rule[]) {
    const skip = missingTable(rule) ? `${rule.tableCheck} missing` : undefined
    if (rule.sql) {
      statements.push({
        name: rule.id,
        sql: rule.sql,
        settings: rule.clickhouseSettings,
        skip,
      })
    }
    for (const action of rule.remediationActions ?? []) {
      if (action.kind === 'diagnostic' && action.sql) {
        statements.push({
          name: `${rule.id} > ${action.id}`,
          sql: action.sql,
          skip,
        })
      }
    }
  }
  const defaultRules = (BUILTIN_RULES as readonly Rule[]).filter((r) =>
    isRuleEnabled(r, [])
  )
  for (const [name, rules] of [
    ['batch (sweep default rules)', defaultRules],
    ['batch (all rules opted in)', BUILTIN_RULES as readonly Rule[]],
  ] as const) {
    const sql = buildBatchedKpiSql(
      partitionRulesForSweep(rules, tables).batched
    )
    if (sql === null) fail(`${name}: buildBatchedKpiSql returned null`)
    statements.push({ name, sql })
  }
  statements.push(
    { name: 'mv-refresh-staleness (staleness)', sql: buildMvStalenessSQL() },
    {
      name: 'mv-refresh-staleness (failed count)',
      sql: buildMvFailedCountSQL(),
    },
    { name: 'slow-query-regression', sql: buildRegressionSQL() }
  )

  for (const analyzer of [0, 1]) {
    const res = await chQuery(
      ch,
      "SELECT getSetting('enable_analyzer') FORMAT TSV",
      { enable_analyzer: analyzer, readonly: 1 }
    )
    const seen = res.text.trim()
    if (seen !== String(analyzer) && seen !== String(analyzer === 1))
      fail(
        `enable_analyzer=${analyzer} did not apply (server reports "${seen}")`
      )
  }

  const rows = [['statement', 'analyzer', 'result']]
  const failures: string[] = []
  let skipped = 0
  for (const st of statements) {
    for (const analyzer of [0, 1]) {
      if (st.skip) {
        rows.push([st.name, String(analyzer), `skip (${st.skip})`])
        skipped++
        continue
      }
      // Same order as production: rule settings, then readonly last.
      const res = await chQuery(ch, `${st.sql}\nFORMAT JSONEachRow`, {
        ...st.settings,
        enable_analyzer: analyzer,
        readonly: 1,
      })
      if (res.ok) {
        rows.push([st.name, String(analyzer), 'ok'])
      } else {
        rows.push([st.name, String(analyzer), 'FAIL'])
        failures.push(
          `${st.name} (analyzer=${analyzer}): ${res.text.trim().slice(0, 400)}`
        )
      }
    }
  }
  printTable(rows)
  console.log(
    `\n${statements.length} statements x 2 analyzers: ${rows.length - 1 - skipped - failures.length} ok, ${skipped} skipped, ${failures.length} failed`
  )
  if (failures.length > 0) fail(`rule SQL failed:\n  ${failures.join('\n  ')}`)
}

// ---------------------------------------------------------------- Delivery

interface Captured {
  method: string
  path: string
  headers: Headers
  body: string
}

async function verifyDelivery(): Promise<void> {
  const certDir = mkdtempSync(join(tmpdir(), 'chm-verify-tls-'))
  tempDirs.push(certDir)
  const cert = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    join(certDir, 'key.pem'),
    '-out',
    join(certDir, 'cert.pem'),
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ])
  if (cert.status !== 0)
    fail(`openssl could not create a test cert: ${cert.stderr}`)

  const captured: Captured[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    tls: {
      cert: Bun.file(join(certDir, 'cert.pem')),
      key: Bun.file(join(certDir, 'key.pem')),
    },
    async fetch(req) {
      const raw = req.url.slice(req.url.indexOf('/', 'https://'.length))
      captured.push({
        method: req.method,
        path: raw,
        headers: req.headers,
        body: await req.text(),
      })
      return Response.json({ event_id: '$verify', ok: true })
    },
  })
  const base = `https://127.0.0.1:${server.port}`

  // Config on this machine (.env files, declarative targets, the event bus)
  // could add real destinations: refuse and report any send that is not ours.
  const stray: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.startsWith(`${base}/`)) {
      stray.push(new URL(url).origin)
      return Promise.reject(new Error('verify-alerting: blocked stray send'))
    }
    return realFetch(input, init)
  }) as typeof fetch

  // The capture server is loopback: open the SSRF guard the documented way
  // (self-host opt-in, forced off in cloud mode) and trust its self-signed cert.
  delete process.env.CHM_CLOUD_MODE
  delete process.env.CHM_DEPLOYMENT_MODE
  process.env.CHM_ALLOW_PRIVATE_HOSTS = 'true'
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const DASH = 'https://dash.verify.test'
  process.env.HEALTH_ALERT_DASHBOARD_URL = DASH

  const { resolveConfig } = await import(
    `${DASHBOARD}/src/lib/config/deployment-mode.ts`
  )
  if (resolveConfig((k: string) => process.env[k]).allowPrivateHosts !== true) {
    fail(
      'CHM_ALLOW_PRIVATE_HOSTS did not take effect; cannot reach the capture server'
    )
  }

  const MATRIX_TOKEN = 'syt_verify_matrix_token'
  const NTFY_TOKEN = 'tk_verify_ntfy_token'
  const ROOM = '!verifyroom:verify.test'

  // URL-detected formats: the adapters match the provider hostname anywhere in
  // the URL, so a `//hooks.slack.com/` path segment selects the real adapter.
  const routeUrls: Record<string, string> = {
    'route-auto': `${base}/t/route-auto/hook`,
    'route-slack': `${base}/t/route-slack//hooks.slack.com/services/T0/B0/x`,
    'route-discord': `${base}/t/route-discord//discord.com/api/webhooks/1/x`,
    'route-teams': `${base}/t/route-teams//verify.webhook.office.com/webhookb2/x`,
    'route-google-chat': `${base}/t/route-google-chat//chat.googleapis.com/v1/spaces/x`,
  }
  const customFormats: Record<string, string> = {
    'custom-auto': 'auto',
    'custom-generic-json': 'raw',
    'custom-raw-details': 'raw',
    'custom-slack': 'slack',
    'custom-matrix': 'matrix',
    'custom-hookshot': 'hookshot',
  }
  const customTargets = Object.entries(customFormats).map(([name, format]) => {
    const urlEnv = `CHM_VERIFY_URL_${name.replace(/-/g, '_').toUpperCase()}`
    process.env[urlEnv] = `${base}/t/${name}/hook`
    // #3998: one raw target opts into the structured `alert` block.
    return name === 'custom-raw-details'
      ? { name, format, urlEnv, details: true }
      : { name, format, urlEnv }
  })
  process.env.HEALTH_ALERT_WEBHOOK_TARGETS = JSON.stringify(customTargets)

  const { detectAdapter } = await import(
    `${DASHBOARD}/src/lib/health/adapters/index.ts`
  )
  const expectedAdapter: Record<string, string> = {
    'route-auto': 'generic-json',
    'route-slack': 'slack',
    'route-discord': 'discord',
    'route-teams': 'msteams',
    'route-google-chat': 'google-chat',
  }
  for (const [name, url] of Object.entries(routeUrls)) {
    const id = detectAdapter(url).id
    if (id !== expectedAdapter[name])
      fail(
        `${name}: detectAdapter chose ${id}, expected ${expectedAdapter[name]}`
      )
  }

  const route = (id: string, extra: Record<string, unknown>) => ({
    id,
    ownerId: '',
    matchRule: '*',
    matchHost: '*',
    channelUrl: '',
    enabled: true,
    createdAt: 0,
    provider: 'webhook',
    serviceName: null,
    routingKey: null,
    telegramBotToken: null,
    telegramChatId: null,
    ntfyUrl: null,
    ntfyToken: null,
    pushoverToken: null,
    pushoverUser: null,
    matrixHomeserverUrl: null,
    matrixAccessToken: null,
    matrixRoomId: null,
    slackChannelId: null,
    minSeverity: null,
    ...extra,
  })
  const routes = [
    ...Object.entries(routeUrls).map(([name, url]) =>
      route(name, { channelUrl: url })
    ),
    route('native-matrix', {
      provider: 'matrix',
      matrixHomeserverUrl: `${base}/t/native-matrix`,
      matrixAccessToken: MATRIX_TOKEN,
      matrixRoomId: ROOM,
    }),
    route('native-ntfy', {
      provider: 'ntfy',
      ntfyUrl: `${base}/t/native-ntfy/alerts`,
      ntfyToken: NTFY_TOKEN,
    }),
  ]

  const { createDispatcher } = await import(
    `${DASHBOARD}/src/lib/health/sweep/dispatch/index.ts`
  )
  const hostId = 900_000 + Math.floor(Math.random() * 90_000)
  const hostName = `verify-host-${hostId}`
  const ctx = {
    settings: {
      webhookUrl: '',
      webhookEnabled: true,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes,
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: '',
      healthchecksUrl: '',
      opsgenie: null,
      email: null,
      telegram: null,
      ntfy: null,
      pushover: null,
      matrix: null,
      twilio: null,
      channelSettings: {},
    },
    channelSettings: {},
    alertingEnabled: true,
    cooldown: { defaultMs: 1, bySeverity: {}, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    repeatBackoffMaxMs: null,
    mutedRules: [],
    enabledRules: [],
    notifyRules: [],
    rules: [],
    thresholdOverrides: {},
    hysteresis: {
      defaults: { minConsecutiveBreaches: 1, minConsecutiveClears: 1 },
      byRule: {},
    },
    orderedCompoundRules: [],
    configs: [],
    windows: [],
    quietHours: [],
    digestWindowMs: 0,
    acks: [],
  }

  const ticks = [
    { kind: 'firing', severity: 'critical', value: 97 },
    { kind: 'reminder', severity: 'critical', value: 98 },
    { kind: 'recovery', severity: 'ok', value: 10 },
  ] as const
  const targets = [
    ...Object.keys(routeUrls),
    ...Object.keys(customFormats),
    'native-matrix',
    'native-ntfy',
  ]
  const failures: string[] = []
  const rows = [['target', 'tick', 'method', 'result']]
  const matrixTxns: string[] = []

  for (const tick of ticks) {
    const start = captured.length
    const dispatcher = await createDispatcher(ctx)
    await dispatcher.dispatchFinding({
      hostId,
      hostName,
      ruleId: 'disk-usage',
      ruleType: 'disk-usage',
      ruleTitle: 'Disk Usage',
      severity: tick.severity,
      value: tick.value,
      label: `${tick.value}% used`,
      warnThreshold: 80,
      critThreshold: 90,
    })
    await dispatcher.flushDigests()
    await dispatcher.flushBusEvents()
    const got = captured.slice(start)

    for (const target of targets) {
      const prefix = `/t/${target}/`
      const reqs = got.filter((r) => r.path.startsWith(prefix))
      if (reqs.length !== 1) {
        rows.push([target, tick.kind, '-', `FAIL (${reqs.length} requests)`])
        failures.push(
          `${target} ${tick.kind}: expected 1 request, got ${reqs.length}`
        )
        continue
      }
      const req = reqs[0]
      const problems: string[] = []
      const isMatrix = target === 'native-matrix'
      const isNtfy = target === 'native-ntfy'
      const token = isMatrix ? MATRIX_TOKEN : isNtfy ? NTFY_TOKEN : null

      if (req.method !== (isMatrix ? 'PUT' : 'POST'))
        problems.push(`method ${req.method}`)
      if (isMatrix) {
        const m = req.path.match(
          /^\/t\/native-matrix\/_matrix\/client\/v3\/rooms\/%21verifyroom%3Averify\.test\/send\/m\.room\.message\/([^/?]+)$/
        )
        if (!m) problems.push(`path ${req.path}`)
        else matrixTxns.push(m[1])
      }
      const auth = req.headers.get('authorization')
      if (token) {
        if (auth !== `Bearer ${token}`)
          problems.push('Authorization header missing or wrong')
        if (req.path.includes(token) || req.body.includes(token))
          problems.push('token leaked outside the header')
      } else if (auth) {
        problems.push('unexpected Authorization header')
      }
      let text = req.body
      if (isNtfy) {
        text += `\n${req.headers.get('title') ?? ''}`
      } else {
        try {
          const body = JSON.parse(req.body) as Record<string, unknown>
          const alert = body.alert as { ruleId?: unknown } | undefined
          if (target === 'custom-raw-details') {
            if (typeof alert?.ruleId !== 'string')
              problems.push('no alert block on a details: true target')
            if ('details' in body) problems.push('legacy details key')
          } else if (alert !== undefined) {
            problems.push('alert block without details: true')
          }
        } catch {
          problems.push('body is not JSON')
        }
      }
      const word = tick.kind === 'recovery' ? /resolved|recover/i : /critical/i
      if (!word.test(text)) problems.push(`no ${word} word`)
      if (!text.includes(hostName)) problems.push('no host')
      if (!text.includes(`${DASH}/health?host=${hostId}`))
        problems.push('no dashboard link')

      const result = problems.length ? `FAIL (${problems.join('; ')})` : 'ok'
      rows.push([target, tick.kind, req.method, result])
      if (problems.length > 0) {
        failures.push(
          `${target} ${tick.kind}: ${problems.join('; ')}\n    body: ${text.slice(0, 300)}`
        )
      }
    }
    if (tick.kind !== 'recovery') await Bun.sleep(5)
  }

  if (new Set(matrixTxns).size !== matrixTxns.length) {
    failures.push(
      `native-matrix: txn ids repeat across sends (${matrixTxns.join(', ')})`
    )
  }
  globalThis.fetch = realFetch
  server.stop(true)
  if (stray.length > 0)
    failures.push(
      `sends outside the capture server (blocked): ${[...new Set(stray)].join(', ')}`
    )
  printTable(rows)
  console.log(
    '\nSSRF escape hatch: CHM_ALLOW_PRIVATE_HOSTS=true (self-host opt-in), which let the loopback capture server through validateHostUrl.'
  )
  if (failures.length > 0)
    fail(`delivery checks failed:\n  ${failures.join('\n  ')}`)
}

// ---------------------------------------------------------------- Suites

function runSuites(): void {
  const runs: [string, string[]][] = [
    [
      DASHBOARD,
      [
        'test',
        'src/lib/alerting',
        'src/lib/health/adapters',
        'src/lib/health/sweep',
      ],
    ],
    [ROOT, ['test', 'tests/repo/docs-data-sync.test.ts']],
  ]
  for (const [cwd, args] of runs) {
    console.log(
      `\n$ (cd ${cwd === ROOT ? '.' : cwd.replace(`${ROOT}/`, '')} && bun ${args.join(' ')})`
    )
    const res = spawnSync('bun', args, {
      cwd,
      stdio: 'inherit',
      env: CALLER_ENV,
    })
    if (res.status !== 0) fail(`bun ${args.join(' ')} exited ${res.status}`)
  }
}

const steps: [string, () => Promise<void> | void][] = [
  [
    'rule SQL against a real ClickHouse',
    async () => verifyRuleSql(await startClickHouse()),
  ],
  ['end-to-end delivery', verifyDelivery],
  ['focused test suites', runSuites],
]
for (const [i, [name, step]] of steps.entries()) {
  console.log(`\n=== ${i + 1}/${steps.length} ${name} ===\n`)
  try {
    await step()
  } catch (err) {
    fail(
      `${name}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    )
  }
  if (i === 0) {
    const ch = clickhouse
    clickhouse = null
    ch?.kill('SIGTERM')
  }
}
cleanup()
console.log('\nverify-alerting: all steps passed')

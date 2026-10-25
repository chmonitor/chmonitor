#!/usr/bin/env bun

/**
 * Plan every shipped query on every given ClickHouse binary.
 *
 *   bun scripts/audit-query-configs.ts --bin <path> [--bin <path> ...]
 *     [--only <substring>] [--json <out.json>] [--all] [--analyzer-off]
 *
 * For each binary this boots a throwaway `clickhouse server` with an embedded
 * Keeper (not `local`: `clickhouse local` never creates the `*_log` tables, so
 * every query_log / part_log view would go unchecked), flushes the system logs
 * so those tables exist, then runs `EXPLAIN PLAN` for:
 *
 *   - every QueryConfig in `apps/dashboard/src/lib/query-config/index.ts`
 *   - every chart builder in `apps/dashboard/src/lib/api/chart-registry.ts`
 *
 * The SQL is the variant `selectVersionedSql` picks for the server's own
 * `version()`, so each binary sees what production sends it. `{name:Type}`
 * placeholders are bound as HTTP `param_*`: `defaultParams` / chart
 * `queryParams` first, else `''` for strings and `0` for numbers. A config's
 * `clickhouseSettings` are sent with it, filtered by the server version through
 * the app's own `dropUnsupportedSettings`, so 26.9+ never sees the analyzer
 * opt-out it rejects. `--analyzer-off` also sends `allow_experimental_analyzer=0`
 * (dropped again on 26.9+) to audit the old analyzer that older servers still
 * run for a config that asks for it.
 *
 * Each cell is classified:
 *   ok      plans
 *   defect  the SQL is wrong for this version (unknown column/function, type
 *           error, syntax)
 *   gated   optional query whose table/column is missing; the app checks
 *           first and shows "unavailable". Not checked on this version.
 *   absent  table missing and the query is NOT optional. Either the page
 *           errors on this version, or the table needs setup this bare server
 *           lacks (kafka, a log with no rows yet). Read each one.
 *   harness an error from a placeholder value the script invented; unchecked
 *   other   any other error; read it
 *
 * Exit code is 1 when any cell is `defect` or `other`.
 */

import type { VersionedSql } from '../packages/sql-builder/src/index'

import {
  getAvailableCharts,
  getChartQuery,
} from '../apps/dashboard/src/lib/api/chart-registry'
import { dropUnsupportedSettings } from '../apps/dashboard/src/lib/api/table-query-settings'
import { queries } from '../apps/dashboard/src/lib/query-config/index'
import {
  parseVersion,
  selectVersionedSql,
} from '../packages/clickhouse-client/src/clickhouse-version'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Status = 'ok' | 'defect' | 'gated' | 'absent' | 'harness' | 'other'

interface AuditItem {
  id: string
  sql: string | VersionedSql[]
  params: Record<string, unknown>
  /** Per-query settings the app sends with this query. */
  settings: Record<string, unknown>
  optional: boolean
  tableCheck: string[]
  columnCheck: string[]
}

interface Cell {
  status: Status
  code?: string
  message?: string
}

interface VersionRun {
  bin: string
  version: string
  cells: Record<string, Cell>
}

// ClickHouse error names that mean the SQL itself is wrong on this version.
const DEFECT_CODES = new Set([
  'UNKNOWN_IDENTIFIER',
  'UNKNOWN_FUNCTION',
  'ILLEGAL_TYPE_OF_ARGUMENT',
  'NUMBER_OF_ARGUMENTS_DOESNT_MATCH',
  'TYPE_MISMATCH',
  'SYNTAX_ERROR',
  'ILLEGAL_AGGREGATION',
  'NO_COMMON_TYPE',
  'UNKNOWN_SETTING',
  'NOT_FOUND_COLUMN_IN_BLOCK',
  'THERE_IS_NO_COLUMN',
  'UNKNOWN_AGGREGATE_FUNCTION',
  'NOT_AN_AGGREGATE',
  'AMBIGUOUS_IDENTIFIER',
  'AMBIGUOUS_COLUMN_NAME',
  'MULTIPLE_EXPRESSIONS_FOR_ALIAS',
  'UNKNOWN_TYPE',
  'CANNOT_CONVERT_TYPE',
  'ILLEGAL_COLUMN',
  'BAD_ARGUMENTS',
  'ATTEMPT_TO_READ_AFTER_EOF',
  'UNKNOWN_ELEMENT_OF_ENUM',
])
const ABSENT_CODES = new Set(['UNKNOWN_TABLE', 'UNKNOWN_DATABASE'])
// Errors an invented placeholder value can cause (empty host, '' cast to an
// enum or number). Only counted as harness when the script made the value up.
const HARNESS_PATTERNS = [
  /CANNOT_EXTRACT_TABLE_STRUCTURE/,
  /parseAddress/,
  /NO_REMOTE_SHARD_FOUND/,
  /converting '' to/,
  /CANNOT_PARSE_/,
]

// Log tables the configs read. A section a version does not know is ignored.
const LOG_TABLES = [
  // Needs an explicit key: on 23.x the default one names a missing
  // `event_date`, and SYSTEM FLUSH LOGS then never returns.
  'opentelemetry_span_log',
  'query_log',
  'query_thread_log',
  'query_views_log',
  'part_log',
  'text_log',
  'trace_log',
  'metric_log',
  'asynchronous_metric_log',
  'crash_log',
  'session_log',
  'processors_profile_log',
  'zookeeper_log',
  'zookeeper_connection_log',
  'asynchronous_insert_log',
  'backup_log',
  'blob_storage_log',
  'error_log',
  'query_metric_log',
  'latency_log',
  'background_schedule_pool_log',
]

function parseArgs(argv: string[]) {
  const bins: string[] = []
  let only: string | undefined
  let json: string | undefined
  let all = false
  let analyzerOff = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--bin') bins.push(resolve(argv[++i]))
    else if (arg === '--only') only = argv[++i]
    else if (arg === '--json') json = argv[++i]
    else if (arg === '--all') all = true
    else if (arg === '--analyzer-off') analyzerOff = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (bins.length === 0)
    throw new Error('pass at least one --bin <clickhouse binary>')
  return { bins, only, json, all, analyzerOff }
}

function toList(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : ([] as string[]).concat(value)
}

function collectItems(): AuditItem[] {
  const items: AuditItem[] = queries.map((config) => ({
    id: `config:${config.name}`,
    sql: config.sql,
    params: (config.defaultParams ?? {}) as Record<string, unknown>,
    settings: (config.clickhouseSettings ?? {}) as Record<string, unknown>,
    optional: Boolean(config.optional),
    tableCheck: toList(config.tableCheck),
    columnCheck: toList(config.columnCheck),
  }))

  for (const name of getAvailableCharts()) {
    const result = getChartQuery(name, {})
    if (!result) continue
    if ('queries' in result) {
      for (const sub of result.queries) {
        items.push({
          id: `chart:${name}#${sub.key}`,
          sql: sub.query,
          params: {},
          settings: {},
          optional: Boolean(sub.optional),
          tableCheck: [],
          columnCheck: [],
        })
      }
      continue
    }
    items.push({
      id: `chart:${name}`,
      sql: result.sql ?? result.query,
      params: result.queryParams ?? {},
      settings: (result.clickhouseSettings ?? {}) as Record<string, unknown>,
      optional: Boolean(result.optional),
      tableCheck: toList(result.tableCheck),
      columnCheck: toList(result.columnCheck),
    })
  }
  return items
}

/**
 * Bind every `{name:Type}` placeholder, preferring the shipped default.
 * `invented` is true when the script had to make a value up, so an error that
 * value causes is the harness's, not the config's.
 */
function bindParams(
  sql: string,
  defaults: Record<string, unknown>
): { bound: Record<string, string>; invented: boolean } {
  const bound: Record<string, string> = {}
  let invented = false
  for (const match of sql.matchAll(
    /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^}]+)\}/g
  )) {
    const [, name, type] = match
    if (name in bound) continue
    if (defaults[name] !== undefined) {
      bound[name] = String(defaults[name])
      continue
    }
    invented = true
    bound[name] = /^\s*(Nullable\()?(U?Int|Float|Decimal)/.test(type) ? '0' : ''
  }
  return { bound, invented }
}

class Server {
  private constructor(
    readonly url: string,
    private readonly proc: ReturnType<typeof spawn>,
    private readonly dir: string
  ) {}

  static async start(bin: string, port: number): Promise<Server> {
    const dir = mkdtempSync(join(tmpdir(), 'chm-audit-'))
    const logs = LOG_TABLES.map((t) => {
      const partition =
        t === 'opentelemetry_span_log'
          ? '<partition_by>toYYYYMM(finish_date)</partition_by>'
          : ''
      return `<${t}><database>system</database><table>${t}</table>${partition}<flush_interval_milliseconds>500</flush_interval_milliseconds></${t}>`
    }).join('\n')
    writeFileSync(
      join(dir, 'config.xml'),
      `<clickhouse>
  <path>${dir}/data/</path><tmp_path>${dir}/tmp/</tmp_path><user_files_path>${dir}/uf/</user_files_path>
  <listen_host>127.0.0.1</listen_host>
  <http_port>${port}</http_port><tcp_port>${port + 1}</tcp_port>
  <logger><level>error</level><log>${dir}/server.log</log><errorlog>${dir}/err.log</errorlog></logger>
  <keeper_server><tcp_port>${port + 2}</tcp_port><server_id>1</server_id>
    <log_storage_path>${dir}/keeper/log</log_storage_path><snapshot_storage_path>${dir}/keeper/snap</snapshot_storage_path>
    <raft_configuration><server><id>1</id><hostname>127.0.0.1</hostname><port>${port + 3}</port></server></raft_configuration>
  </keeper_server>
  <zookeeper><node><host>127.0.0.1</host><port>${port + 2}</port></node></zookeeper>
  <users><default><password></password><networks><ip>127.0.0.1</ip></networks><profile>default</profile><quota>default</quota><access_management>1</access_management></default></users>
  <distributed_ddl><path>/clickhouse/task_queue/ddl</path></distributed_ddl>
  <profiles><default/></profiles><quotas><default/></quotas>
${logs}
</clickhouse>
`
    )
    const proc = spawn(
      bin,
      ['server', '--config-file', join(dir, 'config.xml')],
      {
        // Without this the watchdog parent survives a SIGTERM to the child.
        env: { ...process.env, CLICKHOUSE_WATCHDOG_ENABLE: '0' },
        stdio: 'ignore',
      }
    )
    const server = new Server(`http://127.0.0.1:${port}/`, proc, dir)
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break
      try {
        if (
          (
            await fetch(`${server.url}ping`, {
              headers: { Connection: 'close' },
            })
          ).ok
        ) {
          return server
        }
      } catch {}
      await Bun.sleep(250)
    }
    server.stop()
    throw new Error(`${bin} server did not start; see ${dir}/err.log`)
  }

  async query(
    sql: string,
    params: Record<string, string> = {},
    settings: Record<string, unknown> = {}
  ): Promise<{ ok: boolean; text: string }> {
    const url = new URL(this.url)
    // Explicit: CLICKHOUSE_USER/PASSWORD from the environment must not leak in.
    url.searchParams.set('user', 'default')
    for (const [key, value] of Object.entries(settings))
      url.searchParams.set(key, String(value))
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(`param_${key}`, value)
    // A fresh connection per request: some versions close the socket after an
    // exception and Bun would reuse it for the next query.
    const res = await fetch(url, {
      method: 'POST',
      headers: { Connection: 'close' },
      body: sql,
      signal: AbortSignal.timeout(60_000),
    })
    return { ok: res.ok, text: await res.text() }
  }

  stop(): void {
    this.proc.kill('SIGKILL')
    rmSync(this.dir, { recursive: true, force: true })
  }
}

function errorName(text: string): string {
  const named = [...text.matchAll(/\(([A-Z][A-Z0-9_]+)\)/g)].map((m) => m[1])
  if (named.length > 0) return named[0]
  return `Code ${text.match(/Code: (\d+)/)?.[1] ?? '?'}`
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 300)
}

async function existing(
  server: Server
): Promise<{ tables: Set<string>; columns: Set<string> }> {
  const tables = await server.query(
    "SELECT database || '.' || name FROM system.tables FORMAT TSV"
  )
  const columns = await server.query(
    "SELECT database || '.' || table || '.' || name FROM system.columns WHERE database = 'system' FORMAT TSV"
  )
  const lines = (t: string) => new Set(t.split('\n').filter(Boolean))
  return { tables: lines(tables.text), columns: lines(columns.text) }
}

async function auditBinary(
  bin: string,
  port: number,
  items: AuditItem[],
  analyzerOff: boolean
): Promise<VersionRun> {
  const server = await Server.start(bin, port)
  try {
    // Log tables are created on their first flush; keeper needs a moment.
    await server.query('SELECT 1 FORMAT Null')
    await server.query('SYSTEM FLUSH LOGS').catch(() => undefined)
    const version = (await server.query('SELECT version()')).text.trim()
    const parsed = parseVersion(version)
    const { tables, columns } = await existing(server)
    const cells: Record<string, Cell> = {}

    for (const item of items) {
      if (item.optional) {
        const missing =
          item.tableCheck.find((t) => !tables.has(t)) ??
          item.columnCheck.find((c) => !columns.has(c))
        if (missing) {
          cells[item.id] = { status: 'gated', message: `${missing} absent` }
          continue
        }
      }
      const sql = selectVersionedSql(item.sql, parsed)
      const { bound, invented } = bindParams(sql, item.params)
      const res = await server.query(
        `EXPLAIN PLAN ${sql}`,
        bound,
        dropUnsupportedSettings(
          analyzerOff
            ? { ...item.settings, allow_experimental_analyzer: 0 }
            : item.settings,
          parsed
        )
      )
      if (res.ok) {
        cells[item.id] = { status: 'ok' }
        continue
      }
      const code = errorName(res.text)
      const message = firstLine(res.text)
      let status: Status = 'other'
      if (ABSENT_CODES.has(code)) status = item.optional ? 'gated' : 'absent'
      else if (invented && HARNESS_PATTERNS.some((p) => p.test(res.text)))
        status = 'harness'
      else if (DEFECT_CODES.has(code)) status = 'defect'
      cells[item.id] = { status, code, message }
    }
    return { bin, version, cells }
  } finally {
    server.stop()
  }
}

function printMatrix(
  runs: VersionRun[],
  items: AuditItem[],
  all: boolean
): void {
  const statuses: Status[] = [
    'ok',
    'defect',
    'other',
    'absent',
    'gated',
    'harness',
  ]
  console.log(
    `\n${'status'.padEnd(10)}${runs.map((r) => r.version.padStart(14)).join('')}`
  )
  for (const status of statuses) {
    const counts = runs.map(
      (r) => Object.values(r.cells).filter((c) => c.status === status).length
    )
    console.log(
      `${status.padEnd(10)}${counts.map((n) => String(n).padStart(14)).join('')}`
    )
  }

  const short = (cell: Cell) =>
    cell.status === 'ok'
      ? 'ok'
      : cell.code
        ? `${cell.status}:${cell.code}`
        : cell.status
  const rows = items.filter(
    (item) => all || runs.some((r) => r.cells[item.id]?.status !== 'ok')
  )
  console.log(
    `\n${'query'.padEnd(48)}${runs.map((r) => r.version.padEnd(36)).join('')}`
  )
  for (const item of rows) {
    const cols = runs
      .map((r) => short(r.cells[item.id]).slice(0, 35).padEnd(36))
      .join('')
    console.log(`${item.id.slice(0, 47).padEnd(48)}${cols}`)
  }

  console.log('\nDefects and other errors (first line):')
  for (const item of items) {
    for (const run of runs) {
      const cell = run.cells[item.id]
      if (cell?.status === 'defect' || cell?.status === 'other') {
        console.log(`- ${item.id} @ ${run.version}: ${cell.message}`)
      }
    }
  }
}

async function main(): Promise<void> {
  const { bins, only, json, all, analyzerOff } = parseArgs(
    process.argv.slice(2)
  )
  const items = collectItems().filter((i) => !only || i.id.includes(only))
  console.log(`${items.length} queries x ${bins.length} binaries`)

  const basePort = Number(process.env.CHM_AUDIT_PORT ?? 19100)
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65000) {
    throw new Error(
      `CHM_AUDIT_PORT must be an integer in 1024-65000, got ${process.env.CHM_AUDIT_PORT}`
    )
  }

  const runs: VersionRun[] = []
  // One server at a time: they are heavy and must not fight over ports.
  for (const [index, bin] of bins.entries()) {
    const run = await auditBinary(
      bin,
      basePort + index * 10,
      items,
      analyzerOff
    )
    console.log(`${run.version}: done`)
    runs.push(run)
  }

  printMatrix(runs, items, all)
  if (json) writeFileSync(json, JSON.stringify(runs, null, 2))

  const failed = runs.some((r) =>
    Object.values(r.cells).some(
      (c) => c.status === 'defect' || c.status === 'other'
    )
  )
  process.exit(failed ? 1 : 0)
}

await main()

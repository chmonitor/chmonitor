#!/usr/bin/env bun

/**
 * Generate the docs data files from code, so the docs lists cannot drift.
 *
 * Usage (repo root):
 *   bun scripts/gen-docs-data.ts
 *
 * Writes docs/content/_data/{alert-rules,agent-tools,env-vars,version-matrix}.json.
 * The files are committed; tests/repo/docs-data-sync.test.ts regenerates them
 * in memory and fails when the committed copy is stale. apps/docs/scripts/
 * sync-docs.mjs copies them into the docs app for the MDX data components.
 *
 * Everything here is a static read of code: TS modules are imported directly
 * (no build), nothing touches the network, and output is deterministic
 * (sorted keys, stable order, no timestamps).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
export const DATA_DIR = join(REPO_ROOT, 'docs/content/_data')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JSON with recursively sorted object keys (arrays keep their order). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Run `fn` with env vars set, restoring the previous values afterwards. */
async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => T | Promise<T>
): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// ---------------------------------------------------------------------------
// alert-rules.json
// ---------------------------------------------------------------------------

/**
 * Rule category, derived from the system table the rule reads. A rule whose
 * table is not listed falls back to `other` — add the table here, not a
 * per-rule override.
 */
const TABLE_CATEGORY: Record<string, string> = {
  'system.replicas': 'replication',
  'system.replication_queue': 'replication',
  'system.disks': 'storage',
  'system.parts': 'parts & merges',
  'system.part_log': 'parts & merges',
  'system.merges': 'parts & merges',
  'system.mutations': 'parts & merges',
  'system.tables': 'parts & merges',
  'system.query_log': 'queries',
  'system.processes': 'queries',
  'system.error_log': 'logs',
  'system.text_log': 'logs',
  'system.backup_log': 'backups',
  'system.view_refreshes': 'views',
}

async function buildAlertRules() {
  const { BUILTIN_RULES, BUILTIN_COMPOUND_RULES } = await import(
    '../apps/dashboard/src/lib/alerting/builtin-rules'
  )
  const { HEALTH_CHECKS } = await import(
    '../apps/dashboard/src/components/health/health-checks'
  )
  const checks = new Map<string, any>(HEALTH_CHECKS.map((c: any) => [c.id, c]))

  const rules = BUILTIN_RULES.map((r: any) => {
    const check = checks.get(r.id)
    const actions = (r.remediationActions ?? []) as any[]
    const runbook = actions.find((a) => a.kind === 'runbook' && a.url)
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: (r.tableCheck && TABLE_CATEGORY[r.tableCheck]) || 'other',
      thresholds: {
        warning: r.defaults.warning,
        critical: r.defaults.critical,
      },
      // The rule's own label at the warning threshold, e.g. "30s max delay".
      // Rules carry no unit field; this is what an alert actually says.
      sampleLabel: r.formatLabel ? r.formatLabel(r.defaults.warning) : null,
      tableCheck: r.tableCheck ?? null,
      optional: r.optional === true,
      sql: r.sql ?? null,
      commonCauses: check?.commonCauses ? [...check.commonCauses] : [],
      link: runbook?.url ?? null,
      fix: actions.map((a) => ({
        id: a.id,
        kind: a.kind,
        label: a.label,
        description: a.description ?? null,
        url: a.url ?? null,
        sql: a.sql ?? null,
      })),
    }
  })

  const compound = BUILTIN_COMPOUND_RULES.map((r: any) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: 'compound',
    depends: [...r.depends],
  }))

  return { rules, compound }
}

// ---------------------------------------------------------------------------
// agent-tools.json
// ---------------------------------------------------------------------------

/** Env var that adds a group of agent tools. Same gates as tool-docs-sync.test.ts. */
const AGENT_TOOL_GATES = [
  'AGENT_ENABLE_CONTROL_TOOLS',
  'CHM_FEATURE_POSTGRES_SOURCE',
  'CHM_FEATURE_PEERDB_AGENT',
] as const

async function buildAgentTools() {
  const { createAllTools } = await import(
    '../apps/dashboard/src/lib/ai/agent/tools/index'
  )
  const { TOOL_CATALOG } = await import(
    '../apps/dashboard/src/lib/ai/agent/tools/catalog'
  )
  const off = Object.fromEntries(AGENT_TOOL_GATES.map((g) => [g, 'false']))
  const on = Object.fromEntries(AGENT_TOOL_GATES.map((g) => [g, 'true']))

  const base = new Set(
    await withEnv(off, () => Object.keys(createAllTools(0, true)))
  )
  const gateOf = new Map<string, string>()
  for (const gate of AGENT_TOOL_GATES) {
    const names = await withEnv({ ...off, [gate]: 'true' }, () =>
      Object.keys(createAllTools(0, true))
    )
    for (const n of names) if (!base.has(n)) gateOf.set(n, gate)
  }
  const all = await withEnv(on, () => createAllTools(0, true))

  const tools = Object.keys(all)
    .sort(byString)
    .map((name) => {
      const entry = TOOL_CATALOG[name]
      return {
        name,
        category: entry?.category ?? null,
        summary: entry?.summary ?? null,
        description: (all as any)[name]?.description ?? null,
        core: entry?.core === true,
        envGate: gateOf.get(name) ?? null,
      }
    })

  // The MCP server registers its own tools; capture them with a stub server.
  const { registerAllTools } = await import(
    '../packages/mcp-server/src/tools/index'
  )
  const mcp: { name: string; title: string | null; description: string }[] = []
  registerAllTools({
    registerTool: (name: string, config: any) => {
      mcp.push({
        name,
        title: config?.title ?? null,
        description: config?.description ?? '',
      })
    },
  } as any)
  mcp.sort((a, b) => byString(a.name, b.name))

  return { tools, mcpTools: mcp }
}

// ---------------------------------------------------------------------------
// env-vars.json
// ---------------------------------------------------------------------------

/** Source trees scanned for env reads (packages are where e.g. CLICKHOUSE_HOST is read). */
const ENV_SCAN_ROOTS = ['apps/dashboard/src', 'packages']

/**
 * Names that are read but are not operator configuration:
 * - VITE_*: derived from the canonical CHM_* name in vite.config.ts.
 * - runtime detection set by the platform, never by an operator.
 */
const ENV_IGNORED = new Set([
  'NODE_ENV',
  'KUBERNETES_PORT',
  'KUBERNETES_SERVICE_HOST',
  'DOCKER_CONTAINER',
])
const ENV_IGNORED_PREFIXES = ['VITE_']

const NAME = '([A-Z][A-Z0-9]*_[A-Z0-9_]+)'
const ENV_PATTERNS = [
  // process.env.X, import.meta.env.X, env.X, ctx.env?.X, cfEnv.X
  new RegExp(
    `\\b(?:process\\.env|import\\.meta\\.env|[A-Za-z_$][\\w$]*[eE]nv)\\??\\.${NAME}\\b`,
    'g'
  ),
  // process.env['X'], env?.['X']
  new RegExp(
    `\\b(?:process\\.env|[A-Za-z_$][\\w$]*[eE]nv)\\??\\.?\\[\\s*['"\`]${NAME}['"\`]\\s*\\]`,
    'g'
  ),
  // readEnv('X'), getEnv('X'), env('X'), readEnvFlag('X')
  new RegExp(`\\b[A-Za-z_$]*[eE]nv[A-Za-z_$]*\\(\\s*['"\`]${NAME}['"\`]`, 'g'),
]

const SKIP_FILE = /(\.test\.|\.spec\.|\.cy\.|\.d\.ts$)/
const SKIP_DIR = new Set(['node_modules', '__tests__', 'dist', 'build'])

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(name)) walkSources(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !SKIP_FILE.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** Parse `NAME=value` and `# NAME=value` lines of .env.example. */
function parseEnvExample(): Map<string, { value: string; active: boolean }> {
  const src = readFileSync(
    join(REPO_ROOT, 'apps/dashboard/.env.example'),
    'utf8'
  )
  const out = new Map<string, { value: string; active: boolean }>()
  for (const line of src.split('\n')) {
    const m = line.match(/^(#\s*)?([A-Z][A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const active = !m[1]
    const prev = out.get(m[2])
    // An uncommented assignment wins over a commented example.
    if (prev?.active && !active) continue
    out.set(m[2], { value: m[3].trim(), active })
  }
  return out
}

export function scanEnvNames(): string[] {
  const names = new Set<string>()
  for (const root of ENV_SCAN_ROOTS) {
    for (const file of walkSources(join(REPO_ROOT, root))) {
      const src = readFileSync(file, 'utf8')
      for (const re of ENV_PATTERNS) {
        for (const m of src.matchAll(re)) names.add(m[1])
      }
    }
  }
  return [...names]
    .filter(
      (n) =>
        !ENV_IGNORED.has(n) &&
        !ENV_IGNORED_PREFIXES.some((p) => n.startsWith(p))
    )
    .sort(byString)
}

function buildEnvVars() {
  const example = parseEnvExample()
  const vars = scanEnvNames().map((name) => {
    const ex = example.get(name)
    return {
      name,
      prefix: name.split('_')[0],
      inEnvExample: ex !== undefined,
      // Value only when .env.example sets it uncommented and non-empty.
      exampleDefault: ex?.active && ex.value !== '' ? ex.value : null,
    }
  })
  return {
    scanned: ENV_SCAN_ROOTS,
    vars,
  }
}

// ---------------------------------------------------------------------------
// version-matrix.json
// ---------------------------------------------------------------------------

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function buildVersionMatrix() {
  const { LTS_VERSIONS, SUPPORTED_MAJOR_VERSIONS } = await import(
    './ch-schema/constants'
  )
  const { queries } = await import(
    '../apps/dashboard/src/lib/query-config/index'
  )
  const configs = (queries as any[])
    .filter((c) => Array.isArray(c.sql))
    .map((c) => ({
      name: c.name as string,
      since: [
        ...new Set((c.sql as { since: string }[]).map((s) => s.since)),
      ].sort(compareVersion),
    }))
    .sort((a, b) => byString(a.name, b.name))

  const lts = [...LTS_VERSIONS].sort(compareVersion)
  return {
    minimumSupportedVersion: lts[0],
    ltsVersions: lts,
    supportedMajorVersions: [...SUPPORTED_MAJOR_VERSIONS],
    configs,
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** File name → file contents. Shared by the CLI and the drift test. */
export async function generateDocsData(): Promise<Record<string, string>> {
  return {
    'agent-tools.json': stableJson(await buildAgentTools()),
    'alert-rules.json': stableJson(await buildAlertRules()),
    'env-vars.json': stableJson(buildEnvVars()),
    'version-matrix.json': stableJson(await buildVersionMatrix()),
  }
}

if (import.meta.main) {
  const files = await generateDocsData()
  for (const [name, content] of Object.entries(files)) {
    const path = join(DATA_DIR, name)
    writeFileSync(path, content)
    console.log(`[gen-docs-data] wrote ${relative(REPO_ROOT, path)}`)
  }
}

#!/usr/bin/env bun

/**
 * Patch the generated wrangler.json with routes, vars, and worker name.
 *
 * @cloudflare/vite-plugin generates dist/server/wrangler.json during build,
 * but strips [[routes]] and [vars]. Additionally, Wrangler REJECTS env
 * sections in "redirected" (tool-generated) configs, so we can't use --env.
 * Instead, this script patches the top-level config directly for each target.
 *
 * Worker name/routes are read back from wrangler.toml and the mode-default vars
 * from ./deploy-defaults, so nothing here is hand-synced with those sources.
 *
 * Usage:
 *   bun scripts/patch-wrangler-env.ts              # patch production values
 *   bun scripts/patch-wrangler-env.ts --env preview # patch preview values
 */

// Worker name/routes come from the parsed wrangler.toml — the single source of
// truth — instead of being duplicated here. Bun imports TOML natively.
import wranglerToml from '../wrangler.toml' with { type: 'toml' }
import { modeDefaultVars, parseDeploymentMode } from './deploy-defaults'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

type WranglerTarget = {
  name?: string
  routes?: Array<{ pattern: string; custom_domain?: boolean }>
}
const wrangler = wranglerToml as WranglerTarget & {
  env?: { preview?: WranglerTarget }
}

const envFlag = process.argv.find((a) => a === '--env')
const envName = envFlag ? process.argv[process.argv.indexOf(envFlag) + 1] : null

const JSON_PATH = join(ROOT, 'dist', 'server', 'wrangler.json')

if (!existsSync(JSON_PATH)) {
  console.error(`❌ Generated config not found: ${JSON_PATH}`)
  console.error('   Run `pnpm run build` first.')
  process.exit(1)
}

const generated = JSON.parse(readFileSync(JSON_PATH, 'utf-8'))

// --- Worker runtime vars: single source of truth = .env.production (+ .env.preview) ---
// wrangler.toml no longer declares [vars]. The committed cloud env files are the
// ONLY place worker runtime config lives, shared with the vite client build
// (vite.config.ts loadDeployEnv) so each value is set exactly once. Secrets are
// NOT here — scripts/set-secrets.ts handles those. Deployment-specific values
// (private homelab CLICKHOUSE_HOST/USER/NAME, OPENROUTER_REFERER) are injected
// from CI process.env, overriding the committed localhost placeholders so the
// public repo never carries private topology.
function parseDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf-8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

const isPreview = envName === 'preview'
const fileVars = isPreview
  ? {
      ...parseDotenv(join(ROOT, '.env.production')),
      ...parseDotenv(join(ROOT, '.env.preview')),
    }
  : parseDotenv(join(ROOT, '.env.production'))

// Resolve CHM_DEPLOYMENT_MODE into CONCRETE worker [vars] at deploy time, so the
// worker never depends on per-request runtime derivation (a missing/mismatched
// runtime read would silently drop the cloud public-read posture → anon 401).
// The .env file's explicit values still win over these mode defaults.
// The mode-default matrix comes from ./deploy-defaults — the SAME copy the
// runtime resolver (src/lib/config/deployment-mode.ts) uses, so they can't drift.
const deploymentMode = parseDeploymentMode(fileVars.CHM_DEPLOYMENT_MODE)
const resolvedVars = { ...modeDefaultVars(deploymentMode), ...fileVars }

// Worker [vars] = every non-VITE_ key from the cloud env file. Only the private
// deployment topology is allowed to be overridden from process.env (CI injects
// the real homelab values from repo secrets in the "Patch wrangler config" step;
// the committed file keeps localhost placeholders). The override is a strict
// ALLOWLIST so a stray local env var — e.g. a bun-auto-loaded .env.local — can
// never leak into or corrupt the deployed worker config.
// OPENROUTER_REFERER is intentionally NOT here — it keeps its committed public
// default (https://chmonitor.dev) from .env.production, never overridden at deploy.
const DEPLOY_OVERRIDE_KEYS = new Set([
  'CLICKHOUSE_HOST',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_NAME',
])
const vars: Record<string, string> = {}
for (const [k, v] of Object.entries(resolvedVars)) {
  if (k.startsWith('VITE_')) continue
  const override = DEPLOY_OVERRIDE_KEYS.has(k) ? process.env[k] : undefined
  vars[k] = override && override !== '' ? override : v
}

// Worker name + routes: read from the parsed wrangler.toml (top-level for
// production, [env.preview] for preview) so they are never duplicated here.
const target = isPreview ? wrangler.env?.preview : wrangler
const name = target?.name
const routes = target?.routes
if (!name || !routes || routes.length === 0) {
  console.error(
    `❌ Missing name/routes in wrangler.toml for ${isPreview ? 'env.preview' : 'production'}`
  )
  process.exit(1)
}
const config = { name, routes }

generated.name = config.name
generated.routes = config.routes
generated.vars = vars

// --- Patch D1 databases ---
const conversationsDbId = (
  process.env.CHM_CLOUD_D1_DATABASE_ID ||
  process.env.AGENT_CHM_CLOUD_D1_DATABASE_ID ||
  ''
).trim()

if (conversationsDbId) {
  generated.d1_databases = (generated.d1_databases ?? []).map((db: any) => {
    if (db.binding === 'CHM_CLOUD_D1') {
      return { ...db, database_id: conversationsDbId }
    }
    return db
  })
  console.log(
    `   d1_databases: injected database_id for CHM_CLOUD_D1 (${conversationsDbId})`
  )
} else {
  // Strip CHM_CLOUD_D1 binding if database_id is not provided
  const beforeCount = (generated.d1_databases ?? []).length
  generated.d1_databases = (generated.d1_databases ?? []).filter(
    (db: any) => db.binding !== 'CHM_CLOUD_D1'
  )
  const afterCount = (generated.d1_databases ?? []).length
  if (beforeCount !== afterCount) {
    console.log('   d1_databases: removed unprovisioned CHM_CLOUD_D1 binding')
  }
}

// Serve prerendered routes WITHOUT a trailing-slash redirect. The prerender emits
// dir-style output (dist/client/overview/index.html); CF Workers Assets' default
// `auto-trailing-slash` 308-redirects /overview -> /overview/, adding ~55 ms TTFB on
// every page. `drop-trailing-slash` serves /overview/index.html at /overview directly
// (matching the router's trailingSlash:'never'); /overview/ -> /overview. The
// @cloudflare/vite-plugin only sets `assets.directory`, so html_handling is added here.
generated.assets = {
  ...(generated.assets ?? {}),
  html_handling: 'drop-trailing-slash',
}

// Remove any env sections — Wrangler rejects them in redirected configs
delete generated.env

writeFileSync(JSON_PATH, JSON.stringify(generated, null, 2))

console.log(`✅ Patched wrangler.json for ${envName || 'production'}`)
console.log(`   name: ${config.name}`)
console.log(`   routes: ${config.routes.map((r) => r.pattern).join(', ')}`)
console.log(
  `   vars: ${Object.keys(vars).length} keys (from .env.production${isPreview ? ' + .env.preview' : ''})`
)

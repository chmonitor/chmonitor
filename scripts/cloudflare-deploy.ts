#!/usr/bin/env bun

/**
 * Unified Cloudflare Workers deploy script.
 *
 * Works identically in CI and local — uses the same commands and env vars.
 *
 * Auth (must have one):
 *   - CLOUDFLARE_API_TOKEN env var (recommended for both CI and local)
 *   - wrangler login (local fallback via OAuth)
 *
 * Usage:
 *   bun run cf:deploy
 *
 * Env vars required at deploy time (set via CI secrets or .env.prod/local):
 *   CLICKHOUSE_PASSWORD, CLERK_SECRET_KEY, etc.
 *
 * Non-secret runtime/build vars come from .env.production / .env.preview (the single
 * source of truth); CI overrides only the private CLICKHOUSE_HOST/USER/NAME.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DASHBOARD = join(__dirname, '..', 'apps', 'dashboard')
const ENV_FILE_CANDIDATES = [
  join(DASHBOARD, '.env.production.local'),
  join(DASHBOARD, '.env.local'),
  join(__dirname, '..', '.env.local'),
  join(__dirname, '..', '.env.prod'),
]

// The MCP worker now lives at apps/mcp/. cf:deploy runs with cwd=apps/dashboard,
// so pass an absolute --config path (wrangler resolves `main` relative to it).
const MCP_WRANGLER_CONFIG = join(
  __dirname,
  '..',
  'apps',
  'mcp',
  'wrangler.toml'
)

type Step = [string, string, string, string[]]

function formatCommand(cmd: string, args: string[]): string {
  const quote = (s: string) =>
    /[\s'"$`\\]/.test(s) || s === '' ? JSON.stringify(s) : s
  return [cmd, ...args].map(quote).join(' ')
}

const STEPS: Step[] = [
  ['📦', 'Building for Cloudflare', 'bun', ['run', 'cf:build']],
  [
    '🧩',
    'Preparing Wrangler config',
    'bun',
    [
      '../../scripts/prepare-dashboard-wrangler.ts',
      '--output',
      '.wrangler.deploy.toml',
    ],
  ],
  [
    '🚀',
    'Deploying main worker',
    'wrangler',
    ['deploy', '--minify', '--config', '.wrangler.deploy.toml'],
  ],
  // Deploy the MCP worker separately. Workers Routes on
  // dash.chmonitor.dev/api/mcp* are configured in apps/mcp/wrangler.toml;
  // this command provisions them.
  [
    '🔌',
    'Deploying MCP worker',
    'wrangler',
    ['deploy', '--minify', '--config', MCP_WRANGLER_CONFIG],
  ],
  // Push secrets to both workers AFTER deploy so `wrangler secret bulk` finds
  // the worker on a fresh account. Without this, the MCP worker is live with
  // routes active but no CHM_API_KEY_SECRET → 503s every /api/mcp request.
  // set-secrets.ts is idempotent — safe to run on every deploy.
  ['🔐', 'Pushing secrets to both workers', 'bun', ['run', 'cf:config']],
  [
    '🗄️',
    'Populating remote cache',
    'opennextjs-cloudflare',
    ['populateCache', 'remote'],
  ],
]

// Required for the MCP worker to serve any request in production — without it
// the worker boots and returns 503 to every /api/mcp. Verified BEFORE any
// deploy so we never ship a worker with active routes but no auth secret.
const PREDEPLOY_REQUIRED_SECRETS = [
  'CHM_API_KEY_SECRET',
  'CLICKHOUSE_PASSWORD',
] as const

function loadEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const file of ENV_FILE_CANDIDATES) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([^=]+)=(.*)$/)
      if (match && vars[match[1]] === undefined) vars[match[1]] = match[2]
    }
  }
  return vars
}

function runStep([icon, label, cmd, args]: Step): void {
  console.log(`\n${icon}  ${label}...`)

  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(
      `\n❌ ${label} failed to spawn: ${result.error.message}\n   command: ${formatCommand(cmd, args)}`
    )
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(
      `\n❌ ${label} failed (exit code ${result.status})\n   command: ${formatCommand(cmd, args)}`
    )
    process.exit(result.status ?? 1)
  }
}

function main(): void {
  const binDir = join(__dirname, '..', 'node_modules', '.bin')
  process.env.PATH = [binDir, process.env.PATH].filter(Boolean).join(delimiter)

  const envFile = loadEnvFile()

  // Merge env file vars into process env (env file vars don't override existing)
  for (const [key, value] of Object.entries(envFile)) {
    if (!(key in process.env) && value) {
      process.env[key] = value
    }
  }

  // Warn if no auth method is available
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.warn(
      '⚠️  CLOUDFLARE_API_TOKEN not set — relying on wrangler login OAuth.\n'
    )
    console.warn(
      '   Recommended: set CLOUDFLARE_API_TOKEN in .env.prod or CI secrets'
    )
    console.warn('   for consistent auth across CI and local.\n')
  }

  // Fail fast on missing secrets. The MCP worker activates Workers Routes
  // immediately on deploy; if CHM_API_KEY_SECRET isn't pushable, /api/mcp
  // would 503 every request with no fallback (the main worker's handler is
  // stubbed by cf:build).
  const missingSecrets = PREDEPLOY_REQUIRED_SECRETS.filter(
    (k) => !process.env[k]
  )
  if (missingSecrets.length > 0) {
    console.error(
      `\n❌ Missing required secrets in env: ${missingSecrets.join(', ')}\n` +
        `   Set them in .env.prod / .env.local or as CI secrets before deploying.\n` +
        `   Refusing to deploy MCP worker without them — production /api/mcp would 503.`
    )
    process.exit(1)
  }

  for (const step of STEPS) {
    runStep(step)
  }

  console.log('\n✅ Deploy complete!')
}

main()

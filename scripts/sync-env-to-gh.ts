#!/usr/bin/env bun

/**
 * Sync local env files to GitHub Actions secrets.
 *
 * Cascade (first occurrence of each key wins), per-app first:
 *   apps/dashboard/.env.production.local
 *   apps/dashboard/.env.local
 *   cwd .env.prod.local / .env.prod / .env.local / .env  (root fallback)
 *
 * Then `gh secret set <KEY>` uploads each value. CI's deploy workflow
 * subsequently pushes them onto the Worker via wrangler.
 *
 * Usage:
 *   bun scripts/sync-env-to-gh.ts            # interactive (prints plan, asks)
 *   bun scripts/sync-env-to-gh.ts --yes      # non-interactive
 *   bun scripts/sync-env-to-gh.ts --dry-run  # show what would be set, do nothing
 *   bun scripts/sync-env-to-gh.ts --only KEY1,KEY2
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DASHBOARD = join(REPO_ROOT, 'apps', 'dashboard')

/** Order: highest priority first. First file containing a given key wins. */
const ENV_FILE_CASCADE = [
  join(DASHBOARD, '.env.production.local'),
  join(DASHBOARD, '.env.local'),
  join(REPO_ROOT, '.env.prod.local'),
  join(REPO_ROOT, '.env.prod'),
  join(REPO_ROOT, '.env.local'),
  join(REPO_ROOT, '.env'),
] as const

/**
 * Repo secrets to sync. Mirrors the inventory consumed by
 * `.github/workflows/cloudflare.yml` and `scripts/set-secrets.ts`.
 * NEXT_PUBLIC_* are intentionally excluded — they're build-time only and
 * baked into the JS bundle by CI from repo secrets, not Worker secrets.
 * Cloudflare creds (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID) and Clerk
 * publishable keys are managed manually — out of scope here.
 */
const SECRET_KEYS = [
  // ClickHouse
  'CLICKHOUSE_PASSWORD',
  'CLICKHOUSE_TZ',
  'CLICKHOUSE_EXCLUDE_USER_DEFAULT',
  // LLM providers
  'LLM_API_KEY',
  'LLM_API_BASE',
  'LLM_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_API_BASE',
  'OPENROUTER_REFERER',
  'OPENROUTER_APP_NAME',
  'NVIDIA_API_KEY',
  'NVIDIA_API_BASE',
  'ANYROUTER_API_KEY',
  'ANYROUTER_API_BASE',
  // Clerk (server-side secret keys — publishable keys are public)
  'CLERK_SECRET_KEY',
  'CLERK_SECRET_KEY_TEST',
  // AgentState conversation-store project key (as_live_...). Activates the
  // AgentState backend on the dashboard worker. _TEST is the optional preview
  // key — preview uses it instead of the prod key for data isolation.
  'AGENTSTATE_API_KEY',
  'AGENTSTATE_API_KEY_TEST',
  // HMAC secret for issuing/verifying MCP API keys. CI (cloudflare.yml) pushes
  // this to BOTH the dashboard and the standalone MCP worker; if it is unset
  // here the MCP worker boots with an empty secret and 503s every /api/mcp
  // request ("MCP API key auth is not configured"). Must match across workers.
  'CHM_API_KEY_SECRET',
  // Symmetric key for encrypting per-user connection credentials at rest in D1.
  // When unset it is derived from CLERK_SECRET_KEY (lib/connection-store).
  'CHM_USER_CONNECTIONS_ENCRYPTION_KEY',
  // Polar billing (cloud SaaS). Access token authorizes checkout/portal/product
  // API calls; webhook secret verifies inbound subscription events. Production
  // uses the base names; preview/PR builds resolve the _TEST (sandbox) variants
  // (see set-secrets.ts resolveValue + cloudflare.yml). Non-secret Polar config
  // (CHM_POLAR_SERVER, CHM_POLAR_LICENSE_*) lives in .env.production/.env.preview.
  'POLAR_ACCESS_TOKEN',
  'POLAR_ACCESS_TOKEN_TEST',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_WEBHOOK_SECRET_TEST',
  // Sentry source-map upload token (build-time only; read by the CI build step
  // in cloudflare.yml, NOT pushed onto the worker). The Sentry DSN itself is
  // public and lives in .env.production (CHM_SENTRY_DSN), not here.
  'SENTRY_AUTH_TOKEN',
  // Bug-handler email worker (apps/bug-handler): the GitHub token it uses to open
  // issues from inbound Sentry alert emails. Runtime secret on that worker; CI
  // (cloudflare.yml bug-handler job) pushes it via `wrangler secret put`.
  'BUG_HANDLER_GITHUB_TOKEN',
  // Misc runtime
  'NEXT_QUERY_CACHE_TTL',
] as const

type Args = {
  dryRun: boolean
  yes: boolean
  only: Set<string> | null
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = { dryRun: false, yes: false, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--only') {
      const csv = argv[++i] ?? ''
      args.only = new Set(
        csv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    }
  }
  return args
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip a single matching pair of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) env[key] = value
  }
  return env
}

/** Returns { merged, sources } where sources[key] = filename that supplied it. */
function loadCascade(): {
  merged: Record<string, string>
  sources: Record<string, string>
} {
  const merged: Record<string, string> = {}
  const sources: Record<string, string> = {}
  for (const file of ENV_FILE_CASCADE) {
    if (!existsSync(file)) continue
    const parsed = parseEnvFile(readFileSync(file, 'utf-8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (key in merged) continue // first-write wins (higher priority file)
      if (!value) continue
      merged[key] = value
      sources[key] = file.replace(`${REPO_ROOT}/`, '')
    }
  }
  return { merged, sources }
}

function redact(key: string, value: string): string {
  if (
    key.includes('PASSWORD') ||
    key.includes('SECRET') ||
    key.includes('TOKEN') ||
    key.endsWith('_API_KEY')
  ) {
    if (value.length <= 8) return '***'
    return `${value.slice(0, 4)}…${value.slice(-4)}`
  }
  return value.length > 40 ? `${value.slice(0, 40)}…` : value
}

async function setGhSecret(key: string, value: string): Promise<boolean> {
  const proc = Bun.spawn(['gh', 'secret', 'set', key, '--body', value], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return (await proc.exited) === 0
}

async function promptYes(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `)
  const reply = await new Promise<string>((resolve) => {
    process.stdin.once('data', (d) =>
      resolve(d.toString().trim().toLowerCase())
    )
  })
  return reply === 'y' || reply === 'yes'
}

async function main() {
  const args = parseArgs()
  const { merged, sources } = loadCascade()

  const present = ENV_FILE_CASCADE.filter((f) =>
    existsSync(join(process.cwd(), f))
  )
  if (present.length === 0) {
    console.error(
      `❌ No env files found (looked for: ${ENV_FILE_CASCADE.join(', ')})`
    )
    process.exit(1)
  }

  console.log('📋 Env cascade (first match wins):')
  for (const f of ENV_FILE_CASCADE) {
    const marker = present.includes(f) ? '✓' : '·'
    console.log(`   ${marker} ${f}`)
  }
  console.log()

  const targetKeys = SECRET_KEYS.filter((k) => !args.only || args.only.has(k))

  const plan: Array<{ key: string; value: string; source: string }> = []
  const missing: string[] = []
  for (const key of targetKeys) {
    const value = merged[key]
    if (value) plan.push({ key, value, source: sources[key] })
    else missing.push(key)
  }

  console.log(
    `🔐 Plan: ${plan.length} secret(s) to set, ${missing.length} skipped.\n`
  )
  for (const entry of plan) {
    console.log(
      `   ✓ ${entry.key.padEnd(34)} ← ${entry.source.padEnd(16)}  ${redact(entry.key, entry.value)}`
    )
  }
  for (const key of missing) {
    console.log(
      `   · ${key.padEnd(34)}   (not found in any env file — skipping)`
    )
  }
  console.log()

  if (plan.length === 0) {
    console.log('Nothing to do.')
    return
  }

  if (args.dryRun) {
    console.log('🛈  --dry-run set, exiting without uploading.')
    return
  }

  if (!args.yes) {
    const ok = await promptYes(
      `Upload ${plan.length} secret(s) to GitHub via 'gh secret set'?`
    )
    if (!ok) {
      console.log('Aborted.')
      return
    }
  }

  let failed = 0
  for (const entry of plan) {
    process.stdout.write(`   → gh secret set ${entry.key} ... `)
    const ok = await setGhSecret(entry.key, entry.value)
    console.log(ok ? '✅' : '❌')
    if (!ok) failed++
  }

  console.log()
  if (failed === 0) {
    console.log(`✅ Done. ${plan.length} secret(s) synced to GitHub.`)
    console.log('   Trigger a deploy so CI propagates them to the Worker:')
    console.log('   gh workflow run "Deploy to Cloudflare Workers" --ref main')
  } else {
    console.log(`❌ ${failed} of ${plan.length} failed. See output above.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

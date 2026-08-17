#!/usr/bin/env bun

/**
 * Set Wrangler secrets on the dashboard and/or MCP worker, in batch.
 *
 * Single source of truth for which secrets each worker needs — replaces the
 * per-step `wrangler secret put` lists that used to be hand-duplicated across
 * four jobs in .github/workflows/cloudflare.yml (and drifted: CHM_API_KEY_SECRET
 * was missing from the dashboard there). CI calls this with --from-env; local
 * `cf:config` reads .env.production.local / .env.local.
 *
 * Usage:
 *   bun run cf:config                                  # local: both workers, prod, from .env
 *   bun scripts/set-secrets.ts --from-env --target dashboard --env preview
 *   bun scripts/set-secrets.ts --from-env --target mcp
 *
 * Flags:
 *   --from-env            read values from process.env (CI) instead of .env files
 *   --env <name>          wrangler environment (e.g. preview); omit for production
 *   --target dashboard|mcp|both   which worker(s) to configure (default: both)
 *   --strict              fail (don't skip) if a target worker doesn't exist yet
 *                         — CI sets secrets before deploy, so a skip is unsafe
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Priority: .env.production.local > .env.local (local mode only)
const ENV_FILE_PROD = join(process.cwd(), '.env.production.local')
const ENV_FILE_LOCAL = join(process.cwd(), '.env.local')

// Anchor both wrangler configs to this script so resolution is cwd-independent
// (CI runs us from various working directories).
const DASHBOARD_WRANGLER_CONFIG = join(
  __dirname,
  '..',
  'apps',
  'dashboard',
  'wrangler.toml'
)
const MCP_WRANGLER_CONFIG = join(
  __dirname,
  '..',
  'apps',
  'mcp',
  'wrangler.toml'
)
// Dashboard worker secrets (excludes VITE_*/NEXT_PUBLIC_* build-time vars and the
// non-secret runtime vars that live in .env.production / .env.preview).
const DASHBOARD_SECRET_KEYS = [
  'CLICKHOUSE_PASSWORD',
  // LLM API keys for the AI Agent
  'LLM_API_KEY',
  'LLM_API_BASE',
  'OPENROUTER_API_KEY',
  'OPENROUTER_API_BASE',
  'NVIDIA_API_KEY',
  'NVIDIA_API_BASE',
  'ANYROUTER_API_KEY',
  'ANYROUTER_API_BASE',
  // Clerk server-side secret. In preview the value comes from
  // CLERK_SECRET_KEY_TEST (see resolveValue).
  'CLERK_SECRET_KEY',
  // Verifies inbound Clerk webhooks (Svix signature). Activates the seat-limit
  // gate in webhooks/clerk.ts (organizationMembership.created).
  'CLERK_WEBHOOK_SECRET',
  // Guards the /api/cron/* endpoints (health-sweep, retention-prune) via a
  // constant-time bearer compare. Reuses the CHM_API_KEY_SECRET value in prod.
  'CRON_SECRET',
  // AgentState project key (as_live_...). Presence activates the AgentState
  // conversation-store backend (resolveStore picks it ahead of D1). Non-secret
  // AgentState knobs (base URL, AI-enrich, force-backend) live in
  // .env.production / .env.preview; only the key is a secret.
  'AGENTSTATE_API_KEY',
  // HMAC secret for issuing/verifying MCP API keys. Needed on the dashboard
  // (/api/v1/auth/api-key mints keys via issueApiKey) AND the MCP worker.
  'CHM_API_KEY_SECRET',
  'CHM_USER_CONNECTIONS_ENCRYPTION_KEY',
  // Polar billing (cloud SaaS). Access token authorizes checkout/portal/product
  // API calls; webhook secret verifies inbound subscription events. Non-secret
  // Polar license product ids live in apps/cloud-hooks/.env.production, not dashboard.
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'CLICKHOUSE_TZ',
  'CLICKHOUSE_EXCLUDE_USER_DEFAULT',
  'NEXT_QUERY_CACHE_TTL',
] as const

// Subset the standalone MCP worker consumes — see apps/mcp/wrangler.toml and
// apps/mcp/src/index.ts. CLERK_SECRET_KEY is optional (Clerk OAuth verification)
// and is skipped automatically when unset; without it the dashboard could
// advertise Clerk OAuth while the worker rejects every Clerk token.
const MCP_SECRET_KEYS = [
  'CLICKHOUSE_PASSWORD',
  'CHM_API_KEY_SECRET',
  'CLERK_SECRET_KEY',
] as const

// Defaults applied when a key is absent (mirrors the `|| 'UTC'` etc. that the
// workflow used to inline).
const DEFAULTS: Record<string, string> = {
  CLICKHOUSE_TZ: 'UTC',
  NEXT_QUERY_CACHE_TTL: '3600',
}

type Target = 'dashboard' | 'mcp' | 'both'

interface Args {
  fromEnv: boolean
  env: string | null
  target: Target
  strict: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    fromEnv: false,
    env: null,
    target: 'both',
    strict: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from-env') args.fromEnv = true
    else if (a === '--strict') args.strict = true
    else if (a === '--env') args.env = argv[++i] ?? null
    else if (a === '--target') {
      const t = argv[++i]
      if (t === 'dashboard' || t === 'mcp' || t === 'both') args.target = t
      else {
        console.error(`❌ --target must be dashboard|mcp|both (got "${t}")`)
        process.exit(1)
      }
    }
  }
  return args
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([^=]+)=(.*)$/)
    if (match) env[match[1].trim()] = stripQuotes(match[2].trim())
  }
  return env
}

// Load the value source: process.env (CI) or the .env file (local).
function loadSource(fromEnv: boolean): Record<string, string> {
  if (fromEnv) {
    console.log('📋 Reading secret values from process.env (--from-env)\n')
    return process.env as Record<string, string>
  }
  const file = existsSync(ENV_FILE_PROD)
    ? ENV_FILE_PROD
    : existsSync(ENV_FILE_LOCAL)
      ? ENV_FILE_LOCAL
      : null
  if (!file) {
    console.error('❌ No .env.prod or .env.local found')
    process.exit(1)
  }
  console.log(
    `📋 Reading from ${file.endsWith('.env.production.local') ? '.env.production.local' : '.env.local'}\n`
  )
  return parseEnvFile(readFileSync(file, 'utf-8'))
}

// Resolve the value to push for `key`, applying preview overrides + defaults.
function resolveValue(
  key: string,
  src: Record<string, string>,
  isPreview: boolean
): string {
  // Preview uses the test Clerk key under the prod secret name.
  if (key === 'CLERK_SECRET_KEY' && isPreview) {
    return src.CLERK_SECRET_KEY_TEST ?? src.CLERK_SECRET_KEY ?? ''
  }
  // Preview must NOT reuse the production AgentState project key — otherwise PR
  // preview conversations would land in the prod data plane. Use a dedicated
  // AGENTSTATE_API_KEY_TEST if provided; with none, the value is empty and the
  // secret is skipped, so preview falls back to a non-AgentState backend.
  if (key === 'AGENTSTATE_API_KEY' && isPreview) {
    return src.AGENTSTATE_API_KEY_TEST ?? ''
  }
  // Polar billing: preview uses the SANDBOX token/secret (…_TEST) so PR previews
  // never touch the production Polar org. Production uses the base name; while
  // unset, billing is inert (checkout 501s) — safe until real prod creds exist.
  if (key === 'POLAR_ACCESS_TOKEN' && isPreview) {
    return src.POLAR_ACCESS_TOKEN_TEST ?? ''
  }
  if (key === 'POLAR_WEBHOOK_SECRET' && isPreview) {
    return src.POLAR_WEBHOOK_SECRET_TEST ?? ''
  }
  return src[key] ?? DEFAULTS[key] ?? ''
}

interface SecretPushResult {
  ok: boolean
  missingWorker: boolean
}

// Wrangler's "worker does not exist yet" message varies across versions.
const MISSING_WORKER_PATTERNS = [
  /worker.{0,12}(?:not\s*found|does\s*not\s*exist)/i,
  /service.{0,12}(?:not\s*found|does\s*not\s*exist)/i,
  /could not find a (worker|service)/i,
  /\[code:?\s*10007\]/i,
]

// Transient Cloudflare API conflicts — retried with backoff rather than failed.
// 10215 (`secret-modification-with-worker-versions`) fires when concurrent CI
// runs modify the same worker's secrets at once (e.g. many PRs building in
// parallel); it is not a real error, it just needs a moment and a retry.
const TRANSIENT_CONFLICT_PATTERNS = [
  /\[code:?\s*10215\]/i,
  /secret-modification-with-worker-versions/i,
  /please try again/i,
]

const SECRET_RETRY_DELAYS_MS = [2000, 5000, 10000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function setSecretsBulk(
  label: string,
  configPath: string,
  keys: readonly string[],
  src: Record<string, string>,
  envName: string | null
): Promise<SecretPushResult> {
  const isPreview = envName === 'preview'
  const lines: string[] = []
  const shown: string[] = []
  for (const key of keys) {
    const value = resolveValue(key, src, isPreview)
    if (!value) {
      shown.push(`  ⚠️  ${key} (empty, skip)`)
      continue
    }
    lines.push(`${key}=${value}`)
    const secret = /PASSWORD|SECRET|TOKEN|_API_KEY/.test(key)
    shown.push(`  ✓ ${key}${secret ? ' = ***' : ` = ${value}`}`)
  }

  console.log(
    `\n🔐 ${label} (${lines.length} secrets${envName ? `, --env ${envName}` : ''})`
  )
  console.log(shown.join('\n'))

  if (lines.length === 0) return { ok: false, missingWorker: false }

  const tempFile = join(
    tmpdir(),
    `wrangler-secrets-${process.pid}-${label}.txt`
  )
  // 0o600: the temp file holds plaintext secrets — owner-only read/write.
  writeFileSync(tempFile, lines.join('\n'), { mode: 0o600 })
  try {
    const args = ['secret', 'bulk', tempFile, '--config', configPath]
    if (envName) args.push('--env', envName)
    // `bunx wrangler` resolves the pinned wrangler from the cwd's node_modules
    // (apps/dashboard|apps/mcp both pin 4.65.0) — works whether invoked via
    // `bun run` (local) or directly (`bun scripts/set-secrets.ts` in CI), where
    // node_modules/.bin is not on PATH for a bare `wrangler`.
    // Retry on transient Cloudflare conflicts (10215) so concurrent CI runs
    // don't fail a required check on a race that clears in seconds.
    const maxAttempts = SECRET_RETRY_DELAYS_MS.length + 1
    let stderrText = ''
    let ok = false
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const proc = Bun.spawn(['bunx', 'wrangler', ...args], {
        stdout: 'inherit',
        stderr: 'pipe',
      })
      stderrText = await new Response(proc.stderr).text()
      ok = (await proc.exited) === 0
      const transient =
        !ok && TRANSIENT_CONFLICT_PATTERNS.some((re) => re.test(stderrText))
      if (ok || !transient || attempt === maxAttempts - 1) {
        process.stderr.write(stderrText)
        break
      }
      const delay = SECRET_RETRY_DELAYS_MS[attempt]
      console.warn(
        `\n⏳ ${label}: transient Cloudflare conflict (10215); retrying in ${delay / 1000}s ` +
          `(attempt ${attempt + 2}/${maxAttempts})`
      )
      await sleep(delay)
    }
    return {
      ok,
      missingWorker:
        !ok && MISSING_WORKER_PATTERNS.some((re) => re.test(stderrText)),
    }
  } finally {
    try {
      unlinkSync(tempFile)
    } catch {
      // ignore
    }
  }
}

async function main() {
  const args = parseArgs()
  const src = loadSource(args.fromEnv)

  const jobs: { label: string; config: string; keys: readonly string[] }[] = []
  if (args.target === 'dashboard' || args.target === 'both') {
    jobs.push({
      label: 'dashboard worker',
      config: DASHBOARD_WRANGLER_CONFIG,
      keys: DASHBOARD_SECRET_KEYS,
    })
  }
  if (args.target === 'mcp' || args.target === 'both') {
    jobs.push({
      label: 'MCP worker',
      config: MCP_WRANGLER_CONFIG,
      keys: MCP_SECRET_KEYS,
    })
  }

  for (const job of jobs) {
    const result = await setSecretsBulk(
      job.label,
      job.config,
      job.keys,
      src,
      args.env
    )
    if (!result.ok) {
      if (result.missingWorker && !args.strict) {
        // Benign bootstrap for local cf:deploy (deploy → secrets order): the
        // worker may not exist on a premature standalone `cf:config`.
        console.warn(
          `\n⚠️  ${job.label} not deployed yet — secrets skipped. ` +
            'Deploy it first, then re-run.'
        )
        continue
      }
      // --strict (CI): a missing worker MUST fail. CI sets secrets BEFORE the
      // deploy step, so a silent skip would ship a worker with no secrets.
      console.error(`\n❌ Failed to set ${job.label} secrets`)
      process.exit(1)
    }
  }

  console.log('\n✅ Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

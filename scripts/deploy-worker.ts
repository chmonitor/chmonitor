#!/usr/bin/env bun

/**
 * Unified per-Worker deploy script.
 *
 * Replaces ad-hoc, hand-rolled deploy steps for each apps/* Worker with one
 * command that discovers the app, reads its declared env manifest, and either
 * shells out to the existing dashboard cf:deploy flow (apps/dashboard keeps its
 * own patch-wrangler-env.ts pipeline — this never duplicates it) or runs a
 * plain `wrangler deploy --minify --var K:V ...` + `wrangler secret put` for
 * every other Worker.
 *
 * Usage:
 *   bun scripts/deploy-worker.ts <app> [--env preview] [--dry-run] [--secrets-only|--no-secrets]
 *   bun scripts/deploy-worker.ts --list
 *
 * <app> is a directory name under apps/ that has a wrangler.toml (discovered
 * dynamically — dashboard, cloud-hooks, bug-handler, docs, landing, blog, mcp, …).
 *
 * Manifest convention: each app declares WHICH vars/secrets it needs (never
 * guessed) via a small `apps/<app>/deploy.config.ts` exporting:
 *
 *   export default {
 *     vars: ['CHM_POLAR_SERVER', 'CHM_POLAR_PRODUCT_*'],   // '*' suffix = wildcard prefix match
 *     secrets: ['POLAR_WEBHOOK_SECRET', 'POLAR_ACCESS_TOKEN'],
 *   } satisfies DeployManifest
 *
 * Apps without a deploy.config.ts deploy with no --var/secret pushing (e.g. the
 * dashboard, which manages its own vars via patch-wrangler-env.ts).
 *
 * Env sourcing mirrors the existing convention (root CLAUDE.md "Environment is
 * centralized"):
 *   - non-secret vars:  apps/dashboard/.env.production (+ .env.preview overlay
 *     for --env preview), overridden by apps/<app>/.env.production(.preview)
 *     when present (app file wins).
 *   - secrets:          apps/dashboard/.env.production.local + .env.local,
 *     overridden by apps/<app>/.env.production.local + .env.local when present,
 *     falling back to process.env (so CI can supply secrets without files).
 *
 * Safety: refuses to run (except --dry-run) without CLOUDFLARE_API_TOKEN set.
 * Values are NEVER printed — --dry-run redacts them, missing declared
 * vars/secrets are skipped with a warning (not a hard failure), unrelated
 * failures exit non-zero.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(__dirname, '..')
const APPS_DIR = join(ROOT, 'apps')
const DASHBOARD_DIR = join(APPS_DIR, 'dashboard')

export interface DeployManifest {
  vars?: string[]
  secrets?: string[]
}

export interface ParsedArgs {
  app: string | null
  env: string | null
  dryRun: boolean
  secretsOnly: boolean
  noSecrets: boolean
  list: boolean
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    app: null,
    env: null,
    dryRun: false,
    secretsOnly: false,
    noSecrets: false,
    list: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') args.list = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--secrets-only') args.secretsOnly = true
    else if (a === '--no-secrets') args.noSecrets = true
    else if (a === '--env') args.env = argv[++i] ?? null
    else if (!a.startsWith('--') && args.app === null) args.app = a
  }
  return args
}

// --- .env parsing (mirrors apps/dashboard/scripts/patch-wrangler-env.ts) ---

export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of content.split('\n')) {
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

export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return parseDotenv(readFileSync(path, 'utf-8'))
}

/**
 * Non-secret vars: apps/dashboard/.env.production (+ .env.preview overlay),
 * overridden by the app's own .env.production(.preview) when present.
 */
export function resolveVarsEnv(
  appDir: string,
  isPreview: boolean
): Record<string, string> {
  let merged = loadEnvFile(join(DASHBOARD_DIR, '.env.production'))
  if (isPreview)
    merged = { ...merged, ...loadEnvFile(join(DASHBOARD_DIR, '.env.preview')) }
  if (appDir !== DASHBOARD_DIR) {
    merged = { ...merged, ...loadEnvFile(join(appDir, '.env.production')) }
    if (isPreview)
      merged = { ...merged, ...loadEnvFile(join(appDir, '.env.preview')) }
  }
  return merged
}

/**
 * Secrets: apps/dashboard/.env.production.local + .env.local, overridden by the
 * app's own equivalents when present, falling back to process.env for any key
 * still missing (so CI can inject secrets without files).
 */
export function resolveSecretsEnv(
  appDir: string,
  processEnv: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): Record<string, string> {
  let merged = {
    ...loadEnvFile(join(DASHBOARD_DIR, '.env.local')),
    ...loadEnvFile(join(DASHBOARD_DIR, '.env.production.local')),
  }
  if (appDir !== DASHBOARD_DIR) {
    merged = {
      ...merged,
      ...loadEnvFile(join(appDir, '.env.local')),
      ...loadEnvFile(join(appDir, '.env.production.local')),
    }
  }
  for (const [k, v] of Object.entries(processEnv)) {
    if (v !== undefined && merged[k] === undefined) merged[k] = v
  }
  return merged
}

/**
 * Expands manifest key patterns against a resolved env source. A trailing '*'
 * matches every key with that literal prefix (used for CHM_POLAR_PRODUCT_*);
 * a plain key is returned as-is whether or not it's present (callers report
 * "missing" separately) — only wildcard entries are expanded/dropped here.
 */
export function expandManifestKeys(
  patterns: string[],
  source: Record<string, string>
): string[] {
  const out: string[] = []
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      const matches = Object.keys(source)
        .filter((k) => k.startsWith(prefix))
        .sort()
      out.push(...matches)
    } else {
      out.push(pattern)
    }
  }
  return out
}

export function discoverApps(appsDir: string = APPS_DIR): string[] {
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(appsDir, name, 'wrangler.toml')))
    .sort()
}

export async function loadManifest(appDir: string): Promise<DeployManifest> {
  const path = join(appDir, 'deploy.config.ts')
  if (!existsSync(path)) return {}
  const mod = await import(path)
  const manifest = (mod.default ?? {}) as DeployManifest
  return { vars: manifest.vars ?? [], secrets: manifest.secrets ?? [] }
}

const SECRET_NAME_RE = /PASSWORD|SECRET|TOKEN|_API_KEY/

export function isLikelySecretName(key: string): boolean {
  return SECRET_NAME_RE.test(key)
}

/** Redacts a value for display: secret-shaped keys are always masked. */
export function redactValue(key: string, value: string): string {
  return isLikelySecretName(key) ? '***' : value
}

// --- exec seam (overridable for tests) ---

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
}

export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; input?: string }
) => ExecResult

export const defaultExec: ExecFn = (cmd, args, opts) => {
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd: opts.cwd,
    stdin: opts.input !== undefined ? Buffer.from(opts.input) : 'inherit',
    stdout: 'inherit',
    stderr: 'pipe',
  })
  const stderr = proc.stderr ? proc.stderr.toString() : ''
  if (stderr) process.stderr.write(stderr)
  return { ok: proc.exitCode === 0, stdout: '', stderr }
}

interface RunOptions {
  exec: ExecFn
  log: (msg: string) => void
}

async function run(argv: string[], { exec, log }: RunOptions): Promise<number> {
  const args = parseArgs(argv)

  if (args.list) {
    log('Apps with a wrangler.toml:')
    for (const app of discoverApps()) log(`  - ${app}`)
    return 0
  }

  if (!args.app) {
    log(
      'Usage: bun scripts/deploy-worker.ts <app> [--env preview] [--dry-run] [--secrets-only|--no-secrets]'
    )
    log('       bun scripts/deploy-worker.ts --list')
    return 1
  }

  const appsAvailable = discoverApps()
  if (!appsAvailable.includes(args.app)) {
    log(`❌ Unknown app "${args.app}". Available: ${appsAvailable.join(', ')}`)
    return 1
  }

  if (args.secretsOnly && args.noSecrets) {
    log('❌ --secrets-only and --no-secrets are mutually exclusive')
    return 1
  }

  const appDir = join(APPS_DIR, args.app)
  const isPreview = args.env === 'preview'
  const isDashboard = args.app === 'dashboard'

  if (!args.dryRun && !process.env.CLOUDFLARE_API_TOKEN) {
    log(
      '❌ CLOUDFLARE_API_TOKEN is not set. Refusing to deploy (use --dry-run to preview the plan).'
    )
    return 1
  }

  // apps/dashboard keeps its own patch-wrangler-env.ts pipeline — delegate
  // rather than duplicating it.
  if (isDashboard) {
    const script = isPreview ? 'cf:deploy:preview' : 'cf:deploy'
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8'))
    const resolvedScript = pkg.scripts?.[script] ? script : 'cf:deploy'
    if (args.dryRun) {
      log(
        `[dry-run] would run: cd apps/dashboard && pnpm run ${resolvedScript}`
      )
      return 0
    }
    if (args.secretsOnly) {
      log('[dashboard] running: pnpm run cf:config')
      const result = exec('pnpm', ['run', 'cf:config'], { cwd: ROOT })
      return result.ok ? 0 : 1
    }
    log(`[dashboard] running: pnpm run ${resolvedScript}`)
    const result = exec('pnpm', ['run', resolvedScript], { cwd: appDir })
    if (!result.ok) return 1
    if (!args.noSecrets) {
      log('[dashboard] running: pnpm run cf:config')
      const secretResult = exec('pnpm', ['run', 'cf:config'], { cwd: ROOT })
      if (!secretResult.ok) return 1
    }
    return 0
  }

  const manifest = await loadManifest(appDir)
  const varKeys = manifest.vars ?? []
  const secretKeys = manifest.secrets ?? []

  const varsEnv = resolveVarsEnv(appDir, isPreview)
  const secretsEnv = resolveSecretsEnv(appDir)

  const resolvedVarKeys = expandManifestKeys(varKeys, varsEnv)
  const resolvedSecretKeys = expandManifestKeys(secretKeys, secretsEnv)

  const foundVars: [string, string][] = []
  for (const key of resolvedVarKeys) {
    const value = varsEnv[key]
    if (value === undefined) {
      log(`⚠️  var ${key} not found in env — skipping`)
      continue
    }
    foundVars.push([key, value])
  }

  const foundSecrets: [string, string][] = []
  for (const key of resolvedSecretKeys) {
    const value = secretsEnv[key]
    if (!value) {
      log(`⚠️  secret ${key} not found in env — skipping`)
      continue
    }
    foundSecrets.push([key, value])
  }

  const wranglerEnvArgs = isPreview ? ['--env', 'preview'] : []

  if (args.dryRun) {
    log(`[dry-run] app: ${args.app}${isPreview ? ' (preview)' : ''}`)
    log(
      `[dry-run] vars (${foundVars.length}): ${foundVars.map(([k, v]) => `${k}=${redactValue(k, v)}`).join(', ') || '(none)'}`
    )
    log(
      `[dry-run] secrets (${foundSecrets.length}): ${foundSecrets.map(([k]) => `${k}=***`).join(', ') || '(none)'}`
    )
    if (!args.secretsOnly) {
      const varArgs = foundVars.flatMap(([k]) => ['--var', `${k}:<redacted>`])
      log(
        `[dry-run] would run: wrangler deploy --minify ${wranglerEnvArgs.join(' ')} ${varArgs.join(' ')}`.trim()
      )
    }
    if (!args.noSecrets) {
      for (const [key] of foundSecrets) {
        log(
          `[dry-run] would run: wrangler secret put ${key} ${wranglerEnvArgs.join(' ')}`.trim()
        )
      }
    }
    return 0
  }

  if (!args.secretsOnly) {
    const varArgs = foundVars.flatMap(([k, v]) => ['--var', `${k}:${v}`])
    const redactedVarArgs = foundVars.flatMap(([k]) => [
      '--var',
      `${k}:<redacted>`,
    ])
    log(
      `[${args.app}] deploying: wrangler deploy --minify ${wranglerEnvArgs.join(' ')} ${redactedVarArgs.join(' ')}`.trim()
    )
    const result = exec(
      'wrangler',
      ['deploy', '--minify', ...wranglerEnvArgs, ...varArgs],
      { cwd: appDir }
    )
    if (!result.ok) {
      log(`❌ wrangler deploy failed for ${args.app}`)
      return 1
    }
  }

  if (!args.noSecrets) {
    for (const [key, value] of foundSecrets) {
      log(`[${args.app}] setting secret: ${key}`)
      const result = exec(
        'wrangler',
        ['secret', 'put', key, ...wranglerEnvArgs],
        { cwd: appDir, input: value }
      )
      if (!result.ok) {
        log(`❌ wrangler secret put ${key} failed for ${args.app}`)
        return 1
      }
    }
  }

  log(`✅ Done: ${args.app}${isPreview ? ' (preview)' : ''}`)
  return 0
}

if (import.meta.main) {
  run(process.argv.slice(2), {
    exec: defaultExec,
    log: (m) => console.log(m),
  }).then((code) => process.exit(code))
}

export { run }

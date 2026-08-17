#!/usr/bin/env bun

/**
 * Provision the `cloud.chmonitor.dev → dash.chmonitor.dev` 301 as a Cloudflare
 * edge Redirect Rule (Single Redirect, `http_request_dynamic_redirect` phase).
 *
 * Why an edge rule instead of Next.js middleware:
 *   The dashboard worker serves `cloud.chmonitor.dev`, but its `middleware.ts`
 *   host-redirect never fires for the *prerendered static root* — OpenNext on
 *   Workers returns that asset without invoking the worker, so the middleware
 *   code path is skipped and `/` returns 200 instead of 301. A zone Redirect
 *   Rule runs at the edge BEFORE the worker, so it fires for every path
 *   uniformly, even with `cloud.chmonitor.dev` still attached as a Worker
 *   custom domain (rules precede workers in Cloudflare's order of operations).
 *
 * Idempotent: re-running updates the existing rule (matched by description)
 * and preserves any other dynamic-redirect rules already on the zone.
 *
 * Auth: needs CLOUDFLARE_API_TOKEN with permissions
 *   Zone > Single Redirect > Edit  (manages the dynamic_redirect ruleset)
 *   Zone > Zone > Read             (resolve the zone id before the PUT)
 * Sourced from the environment, then apps/dashboard/.env.local, then
 * repo-root .env.local (token fallback only).
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... bun run scripts/cloudflare-redirect-rule.ts
 *   bun run scripts/cloudflare-redirect-rule.ts --dry-run   # print, don't write
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const DASHBOARD = join(REPO_ROOT, 'apps', 'dashboard')
// Dashboard first (canonical). Root .env.local is token fallback only.
const ENV_FILE_CANDIDATES = [
  join(DASHBOARD, '.env.production.local'),
  join(DASHBOARD, '.env.local'),
  join(REPO_ROOT, '.env.local'),
  join(REPO_ROOT, '.env.prod'),
]

// --- Config -----------------------------------------------------------------

const ZONE_NAME = 'chmonitor.dev'
const FROM_HOST = 'cloud.chmonitor.dev'
const TO_ORIGIN = 'https://dash.chmonitor.dev'
const RULE_DESCRIPTION = `${FROM_HOST} -> dash.chmonitor.dev (301)`
const PHASE = 'http_request_dynamic_redirect'

const DRY_RUN = process.argv.includes('--dry-run')

// --- Env --------------------------------------------------------------------

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

// First file that exists wins. Returns {} if none are present.
function loadEnvFile(): Record<string, string> {
  const file = ENV_FILE_CANDIDATES.find((f) => existsSync(f))
  if (!file) return {}

  const vars: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([^=]+)=(.*)$/)
    // Strip surrounding quotes so `CLOUDFLARE_API_TOKEN="..."` authenticates.
    if (match) vars[match[1].trim()] = stripQuotes(match[2].trim())
  }
  return vars
}

function resolveToken(): string {
  const fromEnv = process.env.CLOUDFLARE_API_TOKEN
  if (fromEnv && fromEnv !== '') return fromEnv
  const token = loadEnvFile().CLOUDFLARE_API_TOKEN
  if (!token || token === '') {
    console.error(
      '❌ CLOUDFLARE_API_TOKEN not set (env, .env.prod, or .env.local —\n' +
        '   repo root or apps/dashboard/).\n' +
        '   Needs Zone > Single Redirect > Edit + Zone > Zone > Read on ' +
        ZONE_NAME +
        '.'
    )
    process.exit(1)
  }
  return token
}

// --- Cloudflare API ---------------------------------------------------------

const API = 'https://api.cloudflare.com/client/v4'

async function cf<T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const json = (await res.json()) as {
    success: boolean
    result: T
    errors?: { code: number; message: string }[]
  }
  if (!res.ok || !json.success) {
    const detail = (json.errors ?? [])
      .map((e) => `[${e.code}] ${e.message}`)
      .join('; ')
    const err = new Error(`CF API ${path} failed (${res.status}): ${detail}`)
    // Expose the status so callers can distinguish "ruleset does not exist
    // yet" (404, benign) from auth/transient failures that must abort.
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return json.result
}

interface RedirectRule {
  id?: string
  version?: string
  last_updated?: string
  ref?: string
  action: string
  action_parameters?: unknown
  expression: string
  description?: string
  enabled?: boolean
}

// The rule we want present. `preserve_query_string` carries `?...` through, so
// the target is just origin + path.
const desiredRule: RedirectRule = {
  action: 'redirect',
  action_parameters: {
    from_value: {
      status_code: 301,
      target_url: {
        expression: `concat("${TO_ORIGIN}", http.request.uri.path)`,
      },
      preserve_query_string: true,
    },
  },
  expression: `(http.host eq "${FROM_HOST}")`,
  description: RULE_DESCRIPTION,
  enabled: true,
}

// Strip server-managed fields (id/version/last_updated) so re-PUTing the
// zone's existing rules is accepted — Cloudflare returns these read-only on
// GET but rejects them in the update payload.
function sanitize(rule: RedirectRule): RedirectRule {
  const { id: _id, version: _v, last_updated: _lu, ...rest } = rule
  return rest
}

async function main() {
  const token = resolveToken()

  console.log(`🔎 Resolving zone id for ${ZONE_NAME}...`)
  const zones = await cf<{ id: string; name: string }[]>(
    token,
    `/zones?name=${ZONE_NAME}`
  )
  const zone = zones[0]
  if (!zone) {
    console.error(`❌ Zone ${ZONE_NAME} not found for this token.`)
    process.exit(1)
  }
  console.log(`   zone id: ${zone.id}`)

  // Read the current dynamic-redirect entrypoint ruleset (404 = none yet).
  let existing: RedirectRule[] = []
  try {
    const ruleset = await cf<{ rules?: RedirectRule[] }>(
      token,
      `/zones/${zone.id}/rulesets/phases/${PHASE}/entrypoint`
    )
    existing = ruleset.rules ?? []
  } catch (err) {
    // A 404 means the zone has no dynamic-redirect entrypoint yet — expected
    // on first run; the PUT below upserts it. Any other status (401/403 auth,
    // 5xx transient) must abort, otherwise we'd silently overwrite the phase
    // with only our rule and drop pre-existing redirects.
    const status = (err as Error & { status?: number }).status
    if (status !== 404) throw err
    console.log('   no existing dynamic-redirect ruleset (will create one)')
  }

  const others = existing.filter((r) => r.description !== RULE_DESCRIPTION)
  const alreadyPresent = existing.some(
    (r) => r.description === RULE_DESCRIPTION
  )
  const rules = [...others.map(sanitize), sanitize(desiredRule)]

  console.log(
    `\n${alreadyPresent ? '♻️  Updating' : '➕ Adding'} rule: ${RULE_DESCRIPTION}`
  )
  console.log(`   ${FROM_HOST}/*  →  301  ${TO_ORIGIN}/<path>?<query>`)
  console.log(`   (preserving ${others.length} other dynamic-redirect rule(s))`)

  if (DRY_RUN) {
    console.log('\n--dry-run: payload that would be PUT:')
    console.log(JSON.stringify({ rules }, null, 2))
    return
  }

  await cf(token, `/zones/${zone.id}/rulesets/phases/${PHASE}/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  })

  console.log('\n✅ Redirect rule provisioned. Verify with:')
  console.log(`   curl -sI https://${FROM_HOST}  # expect 301 → ${TO_ORIGIN}/`)
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

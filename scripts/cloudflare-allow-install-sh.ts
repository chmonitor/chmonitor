#!/usr/bin/env bun

/**
 * Make `curl -sSf https://chmonitor.dev/install.sh | bash` work.
 *
 * Cloudflare Bot Fight Mode (Free) challenges non-browser clients with a
 * managed JS challenge (`cf-mitigated: challenge` → HTTP 403). That challenge
 * cannot be path-skipped with WAF/Configuration Rules — BFM runs outside the
 * Ruleset Engine. The only fix on Free is to turn Bot Fight Mode off for the
 * zone (or upgrade to Super Bot Fight Mode / Bot Management and write Skip
 * rules).
 *
 * This script:
 *   1. Disables Bot Fight Mode (`fight_mode: false`) when the token can.
 *   2. Upserts a Configuration Rule that turns off Browser Integrity Check
 *      and softens security_level for `/install.sh` (defence in depth; does
 *      not replace step 1).
 *
 * Auth: CLOUDFLARE_API_TOKEN with
 *   Zone > Bot Management > Edit   (required for step 1)
 *   Zone > Config Rules > Edit     (step 2; same token that deploys Workers
 *                                   often already has this)
 *   Zone > Zone > Read
 *
 * Usage:
 *   bun run scripts/cloudflare-allow-install-sh.ts
 *   bun run scripts/cloudflare-allow-install-sh.ts --dry-run
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const ENV_FILE_CANDIDATES = [
  join(REPO_ROOT, 'apps', 'dashboard', '.env.production.local'),
  join(REPO_ROOT, 'apps', 'dashboard', '.env.local'),
  join(REPO_ROOT, '.env.local'),
  join(REPO_ROOT, '.env.prod'),
]

const ZONE_NAME = 'chmonitor.dev'
const CONFIG_RULE_DESCRIPTION =
  'Allow curl install.sh (skip BIC / soften security)'
const DRY_RUN = process.argv.includes('--dry-run')

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

function loadEnvFile(): Record<string, string> {
  const file = ENV_FILE_CANDIDATES.find((f) => existsSync(f))
  if (!file) return {}
  const vars: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([^=]+)=(.*)$/)
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
      '❌ CLOUDFLARE_API_TOKEN not set (env or .env.local).\n' +
        '   Needs Zone > Bot Management > Edit + Zone > Config Rules > Edit\n' +
        `   on ${ZONE_NAME}.`
    )
    process.exit(1)
  }
  return token
}

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
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return json.result
}

interface ConfigRule {
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

function sanitize(rule: ConfigRule): ConfigRule {
  const { id: _id, version: _v, last_updated: _lu, ref: _ref, ...rest } = rule
  return rest
}

const desiredConfigRule: ConfigRule = {
  action: 'set_config',
  action_parameters: {
    bic: false,
    security_level: 'essentially_off',
  },
  expression: '(http.request.uri.path eq "/install.sh")',
  description: CONFIG_RULE_DESCRIPTION,
  enabled: true,
}

async function disableBotFightMode(token: string, zoneId: string) {
  console.log('\n🛡️  Bot Fight Mode…')
  try {
    const current = await cf<{ fight_mode?: boolean }>(
      token,
      `/zones/${zoneId}/bot_management`
    )
    console.log(`   fight_mode currently: ${current.fight_mode ?? '(unset)'}`)
    if (current.fight_mode === false) {
      console.log('   already off — nothing to do')
      return true
    }
    if (DRY_RUN) {
      console.log('   --dry-run: would PUT fight_mode=false')
      return true
    }
    await cf(token, `/zones/${zoneId}/bot_management`, {
      method: 'PUT',
      body: JSON.stringify({ fight_mode: false }),
    })
    console.log('   ✅ fight_mode=false')
    return true
  } catch (err) {
    const status = (err as Error & { status?: number }).status
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`   ❌ could not disable Bot Fight Mode: ${msg}`)
    if (status === 403 || /Authentication error|not authorized/i.test(msg)) {
      console.error(
        '\n   Token lacks Zone > Bot Management > Edit.\n' +
          '   Dashboard: Security → Settings → Bot traffic → Bot Fight Mode → Off\n' +
          '   https://dash.cloudflare.com/?to=/:account/:zone/security/settings'
      )
    }
    return false
  }
}

async function upsertConfigRule(token: string, zoneId: string) {
  console.log('\n⚙️  Configuration Rule for /install.sh…')
  let existing: ConfigRule[] = []
  try {
    const ruleset = await cf<{ rules?: ConfigRule[] }>(
      token,
      `/zones/${zoneId}/rulesets/phases/http_config_settings/entrypoint`
    )
    existing = ruleset.rules ?? []
  } catch (err) {
    const status = (err as Error & { status?: number }).status
    if (status !== 404) throw err
    console.log('   no existing config-settings ruleset (will create)')
  }

  const others = existing.filter(
    (r) => r.description !== CONFIG_RULE_DESCRIPTION
  )
  const alreadyPresent = existing.some(
    (r) => r.description === CONFIG_RULE_DESCRIPTION
  )
  const rules = [...others.map(sanitize), sanitize(desiredConfigRule)]

  console.log(
    `   ${alreadyPresent ? '♻️  Updating' : '➕ Adding'}: ${CONFIG_RULE_DESCRIPTION}`
  )
  console.log(`   (preserving ${others.length} other config rule(s))`)

  if (DRY_RUN) {
    console.log('\n--dry-run: payload that would be PUT:')
    console.log(JSON.stringify({ rules }, null, 2))
    return
  }

  await cf(
    token,
    `/zones/${zoneId}/rulesets/phases/http_config_settings/entrypoint`,
    {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    }
  )
  console.log('   ✅ config rule provisioned')
}

async function verifyInstallSh() {
  console.log('\n🔎 Verifying curl https://chmonitor.dev/install.sh …')
  // Give the edge a moment to pick up bot_management changes.
  await Bun.sleep(2000)
  const res = await fetch('https://chmonitor.dev/install.sh', {
    method: 'GET',
    headers: {
      // Default fetch UA is not curl; send curl's UA so we exercise BFM.
      'user-agent': 'curl/8.5.0',
      accept: '*/*',
    },
    redirect: 'manual',
  })
  const body = await res.text()
  const mitigated = res.headers.get('cf-mitigated')
  const ok =
    res.status === 200 && body.startsWith('#!/') && mitigated !== 'challenge'
  if (ok) {
    console.log(
      `   ✅ ${res.status} shebang ok (cf-mitigated=${mitigated ?? 'none'})`
    )
  } else {
    console.error(
      `   ❌ status=${res.status} cf-mitigated=${mitigated ?? 'none'} ` +
        `body[0..40]=${JSON.stringify(body.slice(0, 40))}`
    )
  }
  return ok
}

async function main() {
  const token = resolveToken()

  console.log(`🔎 Resolving zone id for ${ZONE_NAME}…`)
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

  const bfmOk = await disableBotFightMode(token, zone.id)
  await upsertConfigRule(token, zone.id)

  if (DRY_RUN) {
    console.log('\n--dry-run complete (no verify).')
    return
  }

  const verified = await verifyInstallSh()
  if (!verified || !bfmOk) {
    console.error(
      '\n❌ install.sh is still blocked for curl. Turn off Bot Fight Mode in the\n' +
        '   dashboard (see link above), then re-run this script to verify.'
    )
    process.exit(1)
  }

  console.log('\n✅ curl | bash installer path is clear.')
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

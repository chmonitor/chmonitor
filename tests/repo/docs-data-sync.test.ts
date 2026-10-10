/**
 * The docs data files (docs/content/_data/*.json) are generated from code by
 * scripts/gen-docs-data.ts and committed. This test regenerates them in memory
 * and fails when the committed copy is stale, so the docs tables built from
 * them (alert rules, agent tools, env vars, version matrix) cannot drift.
 *
 * It also checks that every env var the dashboard reads is named in the
 * environment-variables reference page. Descriptions stay hand-written in MDX;
 * only the names are checked here.
 */

import {
  DATA_DIR,
  generateDocsData,
  stableJson,
} from '../../scripts/gen-docs-data'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const ENV_DOC = readFileSync(
  join(REPO_ROOT, 'docs/content/reference/environment-variables.mdx'),
  'utf8'
)

const REGEN_HINT = 'run bun scripts/gen-docs-data.ts'

/**
 * Env vars the code reads that environment-variables.mdx does not name yet.
 * This is a ratchet: the list may only shrink. Document a name in the MDX and
 * delete it here. A NEW undocumented env var fails the test — document it
 * instead of adding it here.
 */
const KNOWN_UNDOCUMENTED = new Set([
  // Agent debug / internal tuning
  'AGENT_DEBUG',
  'AGENT_JSON_RENDER_PATCH_GUARD_DEBUG',
  'ANYROUTER_DYNAMIC_MODELS',
  'ANYROUTER_METRICS_CANDIDATE_CAP',
  'ANYROUTER_TOP_MODELS_N',
  'OPENROUTER_FREE_FALLBACK_MODEL',
  // LLM gateway attribution headers
  'APP_CATEGORY',
  'APP_NAME',
  'APP_REFERER',
  'APP_SOURCE',
  'APP_VERSION',
  // Feature flags and events
  'CHM_EVENTS_INGEST_TOKEN',
  'CHM_EVENTS_REEMIT_WEBHOOK_URL',
  'CHM_FEATURE_PEERDB_AGENT',
  'CHM_FEATURE_POSTGRES_SOURCE',
  'CHM_FEATURE_WEBHOOK_SUBSCRIPTIONS',
  'CHM_HEALTH_SWEEP_ENABLED',
  'CHM_MCP_PUBLIC',
  // Clerk
  'CLERK_API_URL',
  'CLERK_OAUTH_ISSUER',
  'CLERK_PUBLISHABLE_KEY',
  // Webhooks / rate limits
  'GITHUB_WEBHOOK_SECRET',
  'RATE_LIMIT_DEVICE_CODE_PER_MIN',
  // Health alert channels and tuning
  'HEALTH_ALERT_COOLDOWN_MINUTES',
  'HEALTH_ALERT_DIGEST_MINUTES',
  'HEALTH_ALERT_EMAIL_ENABLED',
  'HEALTH_ALERT_EMAIL_FROM',
  'HEALTH_ALERT_EMAIL_PROVIDER_URL',
  'HEALTH_ALERT_EMAIL_TO',
  'HEALTH_ALERT_HEALTHCHECKS_URL',
  'HEALTH_ALERT_NTFY_TOKEN',
  'HEALTH_ALERT_NTFY_URL',
  'HEALTH_ALERT_OPSGENIE_API_KEY',
  'HEALTH_ALERT_OPSGENIE_REGION',
  'HEALTH_ALERT_PAGERDUTY_API_KEY',
  'HEALTH_ALERT_PAGERDUTY_ROUTING_KEY',
  'HEALTH_ALERT_PUSHOVER_TOKEN',
  'HEALTH_ALERT_PUSHOVER_USER',
  'HEALTH_ALERT_TELEGRAM_BOT_TOKEN',
  'HEALTH_ALERT_TELEGRAM_CHAT_ID',
  'HEALTH_ALERT_TWILIO_ACCOUNT_SID',
  'HEALTH_ALERT_TWILIO_AUTH_TOKEN',
  'HEALTH_ALERT_TWILIO_FROM',
  'HEALTH_ALERT_TWILIO_MIN_SEVERITY',
  'HEALTH_ALERT_TWILIO_TO',
  'HEALTH_HYSTERESIS_BREACHES',
  'HEALTH_HYSTERESIS_CLEARS',
  // Postgres source (packages/postgres-client)
  'POSTGRES_DATABASE',
  'POSTGRES_HOST',
  'POSTGRES_NAME',
  'POSTGRES_PASSWORD',
  'POSTGRES_PORT',
  'POSTGRES_SSLMODE',
  'POSTGRES_USER',
  // Slack app
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_OAUTH_REDIRECT_URL',
  'SLACK_SIGNING_SECRET',
  'SLACK_TOKEN_ENCRYPTION_KEY',
])

/**
 * Names of the files whose committed content differs from `generated`.
 * Compared as parsed JSON, not bytes: the pre-commit hook runs `biome format`
 * on staged JSON, which may re-wrap arrays without changing the data.
 */
function staleFiles(
  generated: Record<string, string>,
  readCommitted: (name: string) => string | null
): string[] {
  return Object.entries(generated)
    .filter(([name, content]) => {
      const committed = readCommitted(name)
      if (committed === null) return true
      try {
        return !Bun.deepEquals(JSON.parse(committed), JSON.parse(content), true)
      } catch {
        return true
      }
    })
    .map(([name]) => name)
}

function readCommitted(name: string): string | null {
  try {
    return readFileSync(join(DATA_DIR, name), 'utf8')
  } catch {
    return null
  }
}

const generated = await generateDocsData()

const isDocumented = (name: string) => new RegExp(`\\b${name}\\b`).test(ENV_DOC)

describe('docs/content/_data matches the code', () => {
  test('generates the four data files', () => {
    expect(Object.keys(generated).sort()).toEqual([
      'agent-tools.json',
      'alert-rules.json',
      'env-vars.json',
      'version-matrix.json',
    ])
  })

  test('committed JSON is up to date', () => {
    const stale = staleFiles(generated, readCommitted)
    if (stale.length > 0) {
      throw new Error(`Stale docs data (${stale.join(', ')}): ${REGEN_HINT}`)
    }
  })

  test('a changed rule title is caught as stale', () => {
    // Prove the comparison is not vacuous: mutate one rule title in memory
    // and confirm alert-rules.json is reported stale.
    const alerts = JSON.parse(generated['alert-rules.json'])
    alerts.rules[0].title = `${alerts.rules[0].title} (edited)`
    const mutated = {
      ...generated,
      'alert-rules.json': stableJson(alerts),
    }
    expect(staleFiles(mutated, readCommitted)).toEqual(['alert-rules.json'])
  })

  test('output is deterministic', async () => {
    expect(await generateDocsData()).toEqual(generated)
  })
})

describe('env vars are named in environment-variables.mdx', () => {
  const names: string[] = JSON.parse(generated['env-vars.json']).vars.map(
    (v: { name: string }) => v.name
  )

  test('every env var read by the code is documented or known', () => {
    const missing = names.filter(
      (n) => !isDocumented(n) && !KNOWN_UNDOCUMENTED.has(n)
    )
    if (missing.length > 0) {
      throw new Error(
        `Undocumented env vars — add them to docs/content/reference/environment-variables.mdx: ${missing.join(', ')}`
      )
    }
  })

  test('KNOWN_UNDOCUMENTED has no documented or unused entries', () => {
    // Keeps the allowlist shrinking: once a name is documented (or no longer
    // read), it must be removed from the list.
    const stale = [...KNOWN_UNDOCUMENTED].filter(
      (n) => isDocumented(n) || !names.includes(n)
    )
    expect(stale).toEqual([])
  })
})

#!/usr/bin/env bun

/**
 * Sync ALL upstream auth users + organizations (+ memberships) into
 * CHM_CLOUD_D1, then VERIFY the row counts against the provider's reported
 * totals and exit non-zero on a mismatch.
 *
 * Provider-agnostic: the work is done through an IdentityProvider adapter
 * (Clerk today — swap/add another by implementing the interface). Rows land in
 * the provider-scoped `auth_users` / `auth_organizations` /
 * `auth_org_memberships` tables (migration 0006). Idempotent: re-running
 * refreshes existing rows in place (ON CONFLICT upsert).
 *
 * A standalone script can't use the runtime @chm/platform D1 binding, so writes
 * go through `wrangler d1 execute` — the same path as setup-conversations-db.ts.
 *
 * Usage (from repo root or apps/dashboard):
 *   bun apps/dashboard/scripts/sync-clerk.ts            # remote chm-cloud
 *   bun apps/dashboard/scripts/sync-clerk.ts --local    # local d1
 *   bun apps/dashboard/scripts/sync-clerk.ts --dry-run  # print SQL, no writes
 *
 * Auth: CLERK_SECRET_KEY from env, else apps/dashboard/.env.production.local
 * then .env.local. Cloudflare auth is whatever wrangler is logged in as
 * (OAuth or CLOUDFLARE_API_TOKEN) — needs d1 write on the account.
 */

import type { IdentityProvider } from '../src/lib/identity/identity-sync'

import { buildSyncSql } from '../src/lib/identity/identity-sync'
import { ClerkIdentityProvider } from '../src/lib/identity/providers/clerk'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DASHBOARD_DIR = join(import.meta.dir, '..')
const DATABASE_NAME = 'chm-cloud'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const LOCAL = args.has('--local')

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function resolveEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  for (const file of ['.env.production.local', '.env.local']) {
    const path = join(DASHBOARD_DIR, file)
    if (!existsSync(path)) continue
    const parsed = parseEnvFile(readFileSync(path, 'utf-8'))
    if (parsed[key]) return parsed[key]
  }
  return undefined
}

async function runWrangler(extraArgs: string[]): Promise<string> {
  // `bunx wrangler` resolves the pinned wrangler from node_modules (mirrors
  // set-secrets.ts); a bare `wrangler` ENOENTs when .bin is not on PATH.
  const cmd = [
    'bunx',
    'wrangler',
    'd1',
    ...extraArgs,
    LOCAL ? '--local' : '--remote',
  ]
  const proc = Bun.spawn(cmd, {
    cwd: DASHBOARD_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    console.error(stderr || stdout)
    throw new Error(`wrangler ${extraArgs.join(' ')} failed (exit ${code})`)
  }
  return stdout
}

async function d1Count(table: string, provider: string): Promise<number> {
  const out = await runWrangler([
    'execute',
    DATABASE_NAME,
    '--json',
    '--command',
    `SELECT count(*) AS n FROM ${table} WHERE provider='${provider}';`,
  ])
  // wrangler --json prints an array of result objects (after any banner text).
  const start = out.indexOf('[')
  const parsed = JSON.parse(out.slice(start)) as Array<{
    results?: Array<{ n: number }>
  }>
  return parsed[0]?.results?.[0]?.n ?? 0
}

function makeProvider(): IdentityProvider {
  const secretKey = resolveEnv('CLERK_SECRET_KEY')
  if (!secretKey) {
    console.error(
      '❌ CLERK_SECRET_KEY not found (env, .env.production.local, or .env.local)'
    )
    process.exit(1)
  }
  return new ClerkIdentityProvider(secretKey, (m) => console.log(m))
}

async function main() {
  const provider = makeProvider()
  console.log(
    `Identity sync [${provider.name}] → ${LOCAL ? 'local' : 'remote'} ${DATABASE_NAME}${
      DRY_RUN ? ' (dry-run)' : ''
    }\n`
  )

  console.log(`Fetching from ${provider.name}…`)
  const snapshot = await provider.collect()

  const syncedAt = Math.floor(Date.now() / 1000)
  const sql = buildSyncSql(provider.name, snapshot, syncedAt)

  if (snapshot.users.length === 0 && snapshot.orgs.length === 0) {
    console.log(`\nNothing to sync (no ${provider.name} users or orgs).`)
  }

  if (DRY_RUN) {
    console.log('\n--- SQL (dry-run, not executed) ---')
    console.log(sql || '(empty)')
    return
  }

  if (sql.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), 'identity-sync-'))
    const sqlFile = join(dir, 'sync.sql')
    writeFileSync(sqlFile, `${sql}\n`, 'utf-8')
    console.log('\nApplying upserts via wrangler…')
    await runWrangler(['execute', DATABASE_NAME, '--file', sqlFile, '--yes'])
  }

  console.log(`\nVerifying row counts against ${provider.name}…`)
  const [dbUsers, dbOrgs, dbMembers] = await Promise.all([
    d1Count('auth_users', provider.name),
    d1Count('auth_organizations', provider.name),
    d1Count('auth_org_memberships', provider.name),
  ])

  const usersOk = dbUsers >= snapshot.reportedUserCount
  const orgsOk = dbOrgs >= snapshot.reportedOrgCount
  const membersOk = dbMembers >= snapshot.memberships.length

  console.log(
    `  auth_users:           D1=${dbUsers}  upstream=${snapshot.reportedUserCount}  ${usersOk ? '✅' : '❌'}`
  )
  console.log(
    `  auth_organizations:   D1=${dbOrgs}  upstream=${snapshot.reportedOrgCount}  ${orgsOk ? '✅' : '❌'}`
  )
  console.log(
    `  auth_org_memberships: D1=${dbMembers}  synced=${snapshot.memberships.length}  ${membersOk ? '✅' : '❌'}`
  )

  if (usersOk && orgsOk && membersOk) {
    console.log('\n✅ Sync verified.')
  } else {
    console.error(
      '\n❌ Verification failed: D1 counts are below upstream totals.'
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n❌ Sync failed:', err)
  process.exit(1)
})

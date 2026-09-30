/**
 * The declarative source layer (#3497), end to end: real YAML files in a temp
 * `CHM_HEALTH_CONFIG_DIRECTORY`, real env vars, and a real SQLite database
 * behind the D1 API (the committed D1 migrations), read through each of the
 * seven stores' public readers.
 *
 * Why these tests matter: the merge contract says precedence decides who
 * wins a KEY, never which sources are read. A regression to "DB present ⇒
 * ignore the file" (the old shadowing-fallback design) would silently drop an
 * operator's GitOps alerts on every cloud or Postgres deploy — the matrix
 * below fails on exactly that. It also pins that a key only a file defines
 * disappears when the file stops defining it (no tombstones), and that the
 * custom-rules store no longer refuses to read when only a file is present.
 *
 * `import.meta.env` is `process.env` under bun, so setting `SSR` turns on the
 * build-time file-layer gate the Vite build folds to `true` on the server.
 */

import type { SourceLayer } from './merge'

import { installHealthPlatformMock } from '../__tests__/platform-mock'
import { mergeSources } from './merge'
import { Database } from 'bun:sqlite'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- a real SQLite database behind the D1 API --------------------------------

// Portable `import.meta.url` form — tsc does not type Bun's `import.meta.dir`.
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../db/conversations-migrations', import.meta.url)
)
/** The committed migrations for the seven definition tables, in order. */
const HEALTH_MIGRATIONS =
  /^\d{4}_(alert_events|custom_alert_rules|maintenance_windows|alert_routes\w*|quiet_hours|alert_channel_config|alert_digest|alert_webhook_targets)\.sql$/

function sqliteD1() {
  const db = new Database(':memory:')
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (HEALTH_MIGRATIONS.test(file)) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))
    }
  }
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async all<T>() {
      return { results: db.query(sql).all(...(args as never[])) as T[] }
    },
    async first<T>() {
      return (db.query(sql).get(...(args as never[])) as T) ?? null
    },
    async run() {
      const r = db.query(sql).run(...(args as never[]))
      return { meta: { changes: r.changes } }
    },
  })
  return {
    raw: db,
    prepare: (sql: string) => statement(sql),
    async batch(statements: { run(): Promise<unknown> }[]) {
      return Promise.all(statements.map((s) => s.run()))
    },
  }
}

let fakeDb: ReturnType<typeof sqliteD1> | null = null
installHealthPlatformMock(() => fakeDb)

const { _resetHealthConfigCache } = await import('./loader')
const { _resetDeclarativeUrlVerdicts } = await import('./sources')
const { listRoutes } = await import('../alert-routing')
const { listCustomRules, loadCustomRulesIntoRegistry, CustomRuleStoreError } =
  await import('../custom-rules-store')
const { listEffectiveCustomWebhookConfig } = await import(
  '../custom-webhook-config'
)
const { listQuietHours } = await import('../quiet-hours')
const { listWindows, isSuppressed } = await import('../maintenance-windows')
const { resolveDigestSettings, resolveDigestWindowMinutes } = await import(
  '../alert-digest-settings-store'
)
const { listChannelConfigs } = await import('../alert-channel-config-store')
const { ruleRegistry } = await import('@/lib/alerting/rule-registry')

// --- environment ---------------------------------------------------------------

const ENV_KEYS = [
  'SSR',
  'CHM_HEALTH_CONFIG_DIRECTORY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'HEALTH_ALERT_WEBHOOK_TARGETS',
  'HEALTH_ALERT_DIGEST_MINUTES',
  'TG_TOKEN',
  'PD_KEY',
  'HOOK_URL',
  'ENV_HOOK_URL',
  'LOOPBACK_URL',
]
const saved: Record<string, string | undefined> = {}
let dir = ''
let owner = 0
/** A fresh owner per test: the quiet-hours / maintenance DB caches key on it. */
const nextOwner = () => `owner-${++owner}`

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
})
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chm-health-layer-'))
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.SSR = 'true'
  process.env.CHM_HEALTH_CONFIG_DIRECTORY = dir
  process.env.TG_TOKEN = 'tg-secret-token'
  process.env.PD_KEY = 'pd-routing-key'
  process.env.HOOK_URL = 'https://1.1.1.1/hooks/file'
  process.env.ENV_HOOK_URL = 'https://1.0.0.1/hooks/env'
  process.env.LOOPBACK_URL = 'https://127.0.0.1/hooks/internal'
  fakeDb = null
  _resetHealthConfigCache()
  _resetDeclarativeUrlVerdicts()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Write `<concern>.yaml` and drop the per-process file memo (≈ a restart). */
function writeConfig(concern: string, yaml: string): void {
  writeFileSync(join(dir, `${concern}.yaml`), yaml)
  _resetHealthConfigCache()
}
function removeConfig(concern: string): void {
  rmSync(join(dir, `${concern}.yaml`), { force: true })
  _resetHealthConfigCache()
}

// =============================================================================
// The helper: three shapes × precedence
// =============================================================================

describe('mergeSources', () => {
  interface Row {
    id: string
    enabled?: boolean
    token?: string | null
    startsAt?: number
    endsAt?: number
  }
  const env: SourceLayer<Row> = {
    source: 'env',
    entries: [{ id: 'a', enabled: true, token: 'env-token' }],
  }
  const file: SourceLayer<Row> = {
    source: 'file',
    entries: [
      { id: 'a', enabled: true, token: 'file-token' },
      { id: 'f', enabled: true },
    ],
  }
  const d1: SourceLayer<Row> = {
    source: 'd1',
    entries: [
      { id: 'a', enabled: false, token: null },
      { id: 'd', enabled: true },
    ],
  }

  test('union: every key appears; a collision merges field by field, highest source wins', () => {
    const merged = mergeSources([env, file, d1], (r) => r.id, 'union')
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'd', 'f'])
    // D1 set `enabled` and left the token empty — the file's token survives.
    expect(merged.find((r) => r.id === 'a')).toEqual({
      id: 'a',
      enabled: false,
      token: 'file-token',
      source: 'd1',
    })
  })

  test('precedence does not depend on the order layers are passed in', () => {
    const a = mergeSources([d1, env, file], (r) => r.id, 'union')
    const b = mergeSources([env, file, d1], (r) => r.id, 'union')
    expect(a).toEqual(b)
  })

  test('time-union: a shared key is replaced whole, never mixed', () => {
    const lower: SourceLayer<Row> = {
      source: 'file',
      entries: [{ id: 'w', startsAt: 1, endsAt: 100 }],
    }
    const higher: SourceLayer<Row> = {
      source: 'd1',
      entries: [{ id: 'w', startsAt: 50, endsAt: undefined }],
    }
    expect(mergeSources([lower, higher], (r) => r.id, 'time-union')[0]).toEqual(
      { id: 'w', startsAt: 50, endsAt: undefined, source: 'd1' }
    )
  })

  test('single: the highest source that names the value wins outright', () => {
    const [winner] = mergeSources([env, file], () => 'one', 'single')
    expect(winner?.source).toBe('file')
    expect(mergeSources([], () => 'one', 'single')).toEqual([])
  })

  test('deletion is natural: drop a key from its only source and it is gone', () => {
    const without: SourceLayer<Row> = { source: 'file', entries: [] }
    const merged = mergeSources([without, d1], (r) => r.id, 'union')
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'd'])
  })
})

// =============================================================================
// The matrix: (source × store × shape)
// =============================================================================

describe('alert routes (union by id)', () => {
  const ROUTING = `routes:
  - id: ops
    provider: telegram
    target: { chatId: '-100' }
    secretEnv: TG_TOKEN
  - id: pager
    provider: pagerduty
    target: { serviceName: db }
    secretEnv: PD_KEY
  - id: hook
    provider: webhook
    secretEnv: HOOK_URL
  - provider: webhook
    secretEnv: HOOK_URL
`

  test('file only: routes load with secrets resolved from env var names', async () => {
    writeConfig('routing', ROUTING)
    const routes = await listRoutes(nextOwner())
    expect(routes.map((r) => r.id).sort()).toEqual(['hook', 'ops', 'pager'])
    const ops = routes.find((r) => r.id === 'ops')
    expect(ops).toMatchObject({
      source: 'file',
      provider: 'telegram',
      telegramBotToken: 'tg-secret-token',
      telegramChatId: '-100',
    })
    expect(routes.find((r) => r.id === 'pager')).toMatchObject({
      routingKey: 'pd-routing-key',
      serviceName: 'db',
    })
  })

  test('an entry without an id is skipped, never given a generated one', async () => {
    writeConfig('routing', ROUTING)
    const routes = await listRoutes(nextOwner())
    // Four entries in the file, the id-less one is not among the three.
    expect(routes).toHaveLength(3)
  })

  test('a colliding DB row overrides field by field; the file keeps the rest', async () => {
    writeConfig('routing', ROUTING)
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    fakeDb.raw.run(
      `INSERT INTO alert_routes (id, owner_id, match_rule, match_host, channel_url, enabled, created_at, provider)
       VALUES ('ops', ?1, 'disk-*', '*', '', 0, 5, 'telegram')`,
      [ownerId]
    )
    const ops = (await listRoutes(ownerId)).find((r) => r.id === 'ops')
    expect(ops).toMatchObject({
      source: 'd1',
      enabled: false, // DB wins the field it sets
      matchRule: 'disk-*',
      telegramBotToken: 'tg-secret-token', // DB column NULL → file value kept
      telegramChatId: '-100',
    })
  })

  test('a file-only key disappears when the file stops defining it; a DB row with that key stays', async () => {
    writeConfig('routing', ROUTING)
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    fakeDb.raw.run(
      `INSERT INTO alert_routes (id, owner_id, match_rule, match_host, channel_url, enabled, created_at, provider, telegram_bot_token, telegram_chat_id)
       VALUES ('ops', ?1, '*', '*', '', 1, 5, 'telegram', 'db-token', '-200')`,
      [ownerId]
    )
    removeConfig('routing')
    const routes = await listRoutes(ownerId)
    expect(routes.map((r) => r.id)).toEqual(['ops'])
    expect(routes[0]).toMatchObject({
      source: 'd1',
      telegramBotToken: 'db-token',
    })
  })

  test('SSRF: a declared webhook URL on an internal address is dropped', async () => {
    writeConfig(
      'routing',
      `routes:
  - id: internal
    provider: webhook
    secretEnv: LOOPBACK_URL
`
    )
    expect(await listRoutes(nextOwner())).toEqual([])
  })

  test('a missing secret env var skips the route', async () => {
    delete process.env.TG_TOKEN
    writeConfig('routing', ROUTING)
    const ids = (await listRoutes(nextOwner())).map((r) => r.id)
    expect(ids).not.toContain('ops')
  })
})

describe('custom rules (union by id, normalised to custom:<id>)', () => {
  const ALERTS = `rules:
  - id: disk
    name: Disk nearly full
    metric: ${'__METRIC__'}
    op: '>='
    warning: 80
    critical: 90
`
  let metric = ''
  beforeAll(async () => {
    const { METRIC_CATALOG } = await import('../rule-builder-schema')
    metric = Object.keys(METRIC_CATALOG)[0] as string
  })
  const alerts = () => ALERTS.replace('__METRIC__', metric)

  test('no DB, no file: reads keep the honest NOT_CONFIGURED (the UI 501)', async () => {
    const err = await listCustomRules(nextOwner()).catch((e) => e)
    expect(err).toBeInstanceOf(CustomRuleStoreError)
    expect((err as InstanceType<typeof CustomRuleStoreError>).code).toBe(
      'NOT_CONFIGURED'
    )
  })

  test('no DB, file present: reads return the declarative rules instead of throwing', async () => {
    writeConfig('alerts', alerts())
    const rules = await listCustomRules(nextOwner())
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'custom:disk',
      source: 'file',
      enabled: true,
    })
  })

  test('no DB, file present: the sweep registers the declarative rule', async () => {
    writeConfig('alerts', alerts())
    await loadCustomRulesIntoRegistry()
    expect(ruleRegistry.getAll().some((r) => r.id === 'custom:disk')).toBe(true)

    // …and the next sync after the file drops it unregisters it.
    removeConfig('alerts')
    await loadCustomRulesIntoRegistry()
    expect(ruleRegistry.getAll().some((r) => r.id === 'custom:disk')).toBe(
      false
    )
  })

  test('a DB row with the same id disables the declarative rule field by field', async () => {
    writeConfig('alerts', alerts())
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    fakeDb.raw.run(
      `INSERT INTO custom_alert_rules (id, owner_id, name, metric, op, warning, critical, enabled, created_at)
       VALUES ('custom:disk', ?1, 'Disk (tuned)', ?2, '>=', 85, 95, 0, 7)`,
      [ownerId, metric]
    )
    const rules = await listCustomRules(ownerId)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      source: 'd1',
      enabled: false,
      warning: 85,
    })
    await loadCustomRulesIntoRegistry()
    expect(ruleRegistry.getAll().some((r) => r.id === 'custom:disk')).toBe(
      false
    )
  })
})

describe('custom webhook targets (shadow by name, three sources)', () => {
  const CHANNELS = `webhookTargets:
  - id: ops-slack
    name: Ops Slack
    urlEnv: HOOK_URL
`

  test('env, file, and DB targets are all read and tagged with their source', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_TARGETS = JSON.stringify([
      { name: 'matrix', urlEnv: 'ENV_HOOK_URL' },
    ])
    writeConfig('channels', CHANNELS)
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    fakeDb.raw.run(
      `INSERT INTO alert_webhook_targets (owner_id, id, name, url, enabled, format, updated_at)
       VALUES (?1, 'cwt_1', 'Custom', 'https://1.1.1.1/x', 1, 'auto', 3)`,
      [ownerId]
    )
    const { targets } = await listEffectiveCustomWebhookConfig(ownerId)
    const bySource = Object.fromEntries(targets.map((t) => [t.id, t.source]))
    expect(bySource).toEqual({
      'env:matrix': 'env',
      'ops-slack': 'file',
      cwt_1: 'd1',
    })
    expect(targets.find((t) => t.id === 'ops-slack')).toMatchObject({
      url: 'https://1.1.1.1/hooks/file',
      editable: false,
    })
  })

  // #3539: operators silence or override a Helm/file target by saving a D1
  // target under the same name; the D1 row has its own id.
  test('a DB row with a declarative name replaces it whole', async () => {
    writeConfig('channels', CHANNELS)
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    fakeDb.raw.run(
      `INSERT INTO alert_webhook_targets (owner_id, id, name, url, enabled, format, updated_at)
       VALUES (?1, 'cwt_9', 'Ops Slack', 'https://1.1.1.1/hooks/db', 0, 'auto', 3)`,
      [ownerId]
    )
    const { targets } = await listEffectiveCustomWebhookConfig(ownerId)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      id: 'cwt_9',
      source: 'd1',
      editable: true,
      enabled: false,
      url: 'https://1.1.1.1/hooks/db', // never the file URL
    })
  })
})

describe('quiet hours (union by id)', () => {
  const QUIET = `windows:
  - id: nights
    days: [1, 2, 3]
    start: '22:00'
    end: '07:00'
    timezone: UTC
`

  test('file only, and gone again once the file stops defining it', async () => {
    const ownerId = nextOwner()
    writeConfig('quiet-hours', QUIET)
    expect(await listQuietHours(ownerId)).toMatchObject([
      { id: 'nights', source: 'file', start: '22:00' },
    ])
    removeConfig('quiet-hours')
    expect(await listQuietHours(ownerId)).toEqual([])
  })

  test('a DB row with the same id overrides only the fields it sets', async () => {
    writeConfig('quiet-hours', QUIET)
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    await listQuietHours('migrate') // lazily creates the table
    fakeDb.raw.run(
      `INSERT INTO quiet_hours (id, owner_id, days, start_time, end_time, timezone, severity_cap, created_by, created_at)
       VALUES ('nights', ?1, '[0,6]', '23:00', '06:00', 'UTC', 'critical', 'u', 9)`,
      [ownerId]
    )
    expect((await listQuietHours(ownerId))[0]).toMatchObject({
      source: 'd1',
      start: '23:00',
      severityCap: 'critical',
    })
  })
})

describe('maintenance windows (time union)', () => {
  const now = Date.parse('2026-09-30T12:00:00Z')

  test('windows from different sources are all active at once', async () => {
    writeConfig(
      'maintenance',
      `windows:
  - id: file-window
    hostId: 1
    startsAt: '2026-09-30T11:00:00Z'
    endsAt: '2026-09-30T13:00:00Z'
`
    )
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    await listWindows('migrate') // lazily creates the table
    fakeDb.raw.run(
      `INSERT INTO maintenance_windows (id, owner_id, host_id, reason, starts_at, ends_at, created_by, created_at)
       VALUES ('db-window', ?1, 2, 'deploy', ?2, ?3, 'u', 1)`,
      [ownerId, now - 1000, now + 1000]
    )
    const windows = await listWindows(ownerId)
    expect(windows.map((w) => [w.id, w.source]).sort()).toEqual([
      ['db-window', 'd1'],
      ['file-window', 'file'],
    ])
    expect(isSuppressed(windows, 1, now)).toBe(true)
    expect(isSuppressed(windows, 2, now)).toBe(true)
    expect(isSuppressed(windows, 3, now)).toBe(false)
  })

  test('a shared id is replaced whole by the DB window', async () => {
    writeConfig(
      'maintenance',
      `windows:
  - id: shared
    startsAt: '2026-09-30T11:00:00Z'
    endsAt: '2026-09-30T13:00:00Z'
`
    )
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    await listWindows('migrate')
    fakeDb.raw.run(
      `INSERT INTO maintenance_windows (id, owner_id, host_id, reason, starts_at, ends_at, created_by, created_at)
       VALUES ('shared', ?1, NULL, '', 1, 2, 'u', 1)`,
      [ownerId]
    )
    const [w] = await listWindows(ownerId)
    expect(w).toMatchObject({ source: 'd1', startsAt: 1, endsAt: 2 })
    expect(isSuppressed([w], 1, now)).toBe(false)
  })
})

describe('channel config (union by channel)', () => {
  const CHANNELS = `channels:
  - channel: telegram
    target: { chatId: '-100' }
    secretEnv: TG_TOKEN
  - channel: webhook
    target: { url: 'https://127.0.0.1/internal' }
`

  test('file only: secret resolved; an internal URL is dropped (SSRF)', async () => {
    writeConfig('channels', CHANNELS)
    const configs = await listChannelConfigs(nextOwner())
    expect(configs.map((c) => c.channel)).toEqual(['telegram'])
    expect(configs[0]).toMatchObject({
      source: 'file',
      secret: 'tg-secret-token',
      target: { chatId: '-100' },
    })
  })

  test('a DB row overrides `enabled` and keeps the file secret when its own is empty', async () => {
    writeConfig('channels', CHANNELS)
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    fakeDb.raw.run(
      `INSERT INTO alert_channel_config (owner_id, channel, enabled, min_severity, target_json, secret, updated_at)
       VALUES (?1, 'telegram', 0, 'critical', '{}', '', 4)`,
      [ownerId]
    )
    expect((await listChannelConfigs(ownerId))[0]).toMatchObject({
      source: 'd1',
      enabled: false,
      minSeverity: 'critical',
      secret: 'tg-secret-token',
      target: { chatId: '-100' },
    })
  })
})

describe('digest settings (single value)', () => {
  test('default → env → file → DB, each higher source winning outright', async () => {
    const ownerId = nextOwner()
    expect(await resolveDigestSettings(ownerId)).toBeNull()
    expect(await resolveDigestWindowMinutes(ownerId)).toBe(0)

    process.env.HEALTH_ALERT_DIGEST_MINUTES = '10'
    expect(await resolveDigestSettings(ownerId)).toMatchObject({
      source: 'env',
      windowMinutes: 10,
    })

    writeConfig('digest', 'enabled: true\nwindowMinutes: 20\n')
    expect(await resolveDigestSettings(ownerId)).toMatchObject({
      source: 'file',
      windowMinutes: 20,
    })

    fakeDb = sqliteD1()
    fakeDb.raw.run(
      `INSERT INTO alert_channel_config (owner_id, channel, enabled, min_severity, target_json, secret, updated_at)
       VALUES (?1, '__digest__', 0, NULL, '{"windowMinutes":30}', NULL, 1)`,
      [ownerId]
    )
    expect(await resolveDigestSettings(ownerId)).toMatchObject({
      source: 'd1',
      enabled: false,
    })
    expect(await resolveDigestWindowMinutes(ownerId)).toBe(0)
  })
})

describe('the env layer only carries the settings that have an env form', () => {
  test('with env set and no file, route/rule/quiet/maintenance/channel stores contribute nothing', async () => {
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '10'
    process.env.HEALTH_ALERT_WEBHOOK_TARGETS = JSON.stringify([
      { name: 'matrix', urlEnv: 'ENV_HOOK_URL' },
    ])
    fakeDb = sqliteD1()
    const ownerId = nextOwner()
    expect(await listRoutes(ownerId)).toEqual([])
    expect(await listCustomRules(ownerId)).toEqual([])
    expect(await listQuietHours(ownerId)).toEqual([])
    expect(await listWindows(ownerId)).toEqual([])
    expect(await listChannelConfigs(ownerId)).toEqual([])
  })
})

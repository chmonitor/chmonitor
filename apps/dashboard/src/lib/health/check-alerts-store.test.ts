/**
 * #3438 (PR 1/3) — built-in check alerts as `custom_alert_rules` rows.
 *
 * Runs the real stores and routes against a real SQLite database behind the
 * D1 API, built from the committed migrations (0014 + 0032 for
 * `custom_alert_rules`, 0014 for `alert_acks`). What these pin:
 *
 * - a check row never leaks into the custom-rule surfaces (list, delete,
 *   sweep registry) — on the pre-0032 store those queries had no
 *   `check_id IS NULL` filter and returned / deleted the row;
 * - rename is an upsert on (owner_id, check_id): one row per check, and the
 *   alert's `ruleId` stays the check id, so an ACK written before the rename
 *   is still found with the `ruleId` the API returns afterwards;
 * - with no metadata DB the list still answers (defaults) and writes 501.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../db/conversations-migrations', import.meta.url)
)
const MIGRATIONS = [
  '0014_alert_acks.sql',
  '0014_custom_alert_rules.sql',
  '0032_custom_alert_rules_check_alerts.sql',
]

function sqliteD1() {
  const db = new Database(':memory:')
  for (const file of MIGRATIONS) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))
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

const { listCheckAlerts, renameCheckAlert, resetCheckAlert, isKnownCheckId } =
  await import('./check-alerts-store')
const {
  createCustomRule,
  deleteCustomRule,
  listCustomRules,
  loadCustomRulesIntoRegistry,
} = await import('./custom-rules-store')
const { ackAlert, listActiveAcks } = await import('./alert-ack-store')
const { ruleRegistry } = await import('@/lib/alerting/rule-registry')
const { HEALTH_CHECKS } = await import('@/components/health/health-checks')
const { BUILTIN_RULES, BUILTIN_COMPOUND_RULES } = await import(
  '@/lib/alerting/builtin-rules'
)
const { __handleGetForTests: handleGet } = await import(
  '@/routes/api/v1/health/check-alerts'
)
const { __handlePutForTests: handlePut, __handleDeleteForTests: handleDelete } =
  await import('@/routes/api/v1/health/check-alerts/$checkId')

const OWNER = 'owner-1'
/** Union of browser check ids and server sweep rule ids. */
const KNOWN_ID_COUNT = new Set([
  ...HEALTH_CHECKS.map((c) => c.id),
  ...BUILTIN_RULES.map((r) => r.id),
  ...BUILTIN_COMPOUND_RULES.map((r) => r.id),
]).size

const putRequest = (body: unknown) =>
  new Request('http://localhost/api/v1/health/check-alerts/max-parts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  delete process.env.POSTGRES_PRISMA_URL
  fakeDb = sqliteD1()
})

describe('check alert store (D1)', () => {
  test('lists every known check with its default title', async () => {
    const list = await listCheckAlerts(OWNER)
    // Browser checks come first, in HEALTH_CHECKS order.
    expect(list.slice(0, HEALTH_CHECKS.length).map((c) => c.checkId)).toEqual(
      HEALTH_CHECKS.map((c) => c.id)
    )
    const maxParts = list.find((c) => c.checkId === 'max-parts')
    expect(maxParts).toMatchObject({
      ruleId: 'max-parts',
      source: 'default',
      updatedAt: null,
    })
    expect(maxParts?.name).toBe(maxParts?.defaultName as string)
  })

  test('rename upserts one row per (owner, check); ruleId stays the check id', async () => {
    await renameCheckAlert(OWNER, 'max-parts', 'Parts first')
    const renamed = await renameCheckAlert(OWNER, 'max-parts', '  Parts  ')
    expect(renamed).toMatchObject({
      checkId: 'max-parts',
      ruleId: 'max-parts',
      name: 'Parts',
      source: 'd1',
    })
    const rows = fakeDb?.raw
      .query(
        `SELECT id, name, metric, op, warning, critical FROM custom_alert_rules WHERE check_id = 'max-parts'`
      )
      .all()
    expect(rows).toHaveLength(1)
    // No sentinel values: a check row carries no metric/op/thresholds.
    expect(rows?.[0]).toMatchObject({
      name: 'Parts',
      metric: null,
      op: null,
      warning: null,
      critical: null,
    })
    const listed = (await listCheckAlerts(OWNER)).find(
      (c) => c.checkId === 'max-parts'
    )
    expect(listed).toMatchObject({ name: 'Parts', source: 'd1' })
    // Other owners still see the default.
    const other = (await listCheckAlerts('owner-2')).find(
      (c) => c.checkId === 'max-parts'
    )
    expect(other?.source).toBe('default')
  })

  test('reset drops the stored name', async () => {
    await renameCheckAlert(OWNER, 'max-parts', 'Parts')
    const reset = await resetCheckAlert(OWNER, 'max-parts')
    expect(reset.source).toBe('default')
    const listed = (await listCheckAlerts(OWNER)).find(
      (c) => c.checkId === 'max-parts'
    )
    expect(listed?.source).toBe('default')
  })

  // The server sweep is the only writer of alert_state, and several of its
  // rule ids are not browser checks. Every id that can appear as an
  // alert_state / ACK ruleId must be nameable, or those alerts can never be
  // renamed. On the HEALTH_CHECKS-only store these were NOT_FOUND.
  test('every server sweep rule id is a known, nameable check', async () => {
    const sweepRules = [...BUILTIN_RULES, ...BUILTIN_COMPOUND_RULES]
    const list = await listCheckAlerts(OWNER)
    const ids = new Set(list.map((c) => c.checkId))
    for (const rule of sweepRules) {
      expect(isKnownCheckId(rule.id)).toBe(true)
      expect(ids.has(rule.id)).toBe(true)
    }
    for (const check of HEALTH_CHECKS) expect(ids.has(check.id)).toBe(true)
    // No duplicates: a shared id is listed once.
    expect(ids.size).toBe(list.length)

    // Server-only rules default to the sweep rule's own title.
    for (const id of [
      'disk-usage',
      'keeper-unavailable',
      'fatal-log-entries',
      'replica-split-brain',
      'merge-pressure',
    ]) {
      const rule = sweepRules.find((r) => r.id === id)
      expect(rule).toBeDefined()
      expect(list.find((c) => c.checkId === id)?.defaultName).toBe(
        rule?.title as string
      )
    }

    const renamed = await renameCheckAlert(OWNER, 'disk-usage', 'Disk (prod)')
    expect(renamed).toMatchObject({
      ruleId: 'disk-usage',
      name: 'Disk (prod)',
      defaultName: 'Disk Usage',
    })
  })

  test('unknown check ids and empty names are rejected', async () => {
    expect(isKnownCheckId('max-parts')).toBe(true)
    await expect(
      renameCheckAlert(OWNER, 'custom:x', 'n')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(resetCheckAlert(OWNER, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(renameCheckAlert(OWNER, 'max-parts', '   ')).rejects.toThrow()
  })
})

describe('check rows never leak into custom rules', () => {
  test('listCustomRules, deleteCustomRule and the sweep registry ignore check rows', async () => {
    const custom = await createCustomRule(OWNER, {
      name: 'Stuck merges',
      metric: 'stuck-merges',
      op: '>=',
      warning: 1,
      critical: 3,
    })
    const renamed = await renameCheckAlert(OWNER, 'max-parts', 'Parts')
    const checkRowId = (
      fakeDb?.raw
        .query(`SELECT id FROM custom_alert_rules WHERE check_id = 'max-parts'`)
        .get() as { id: string }
    ).id

    const listed = await listCustomRules(OWNER)
    expect(listed.map((r) => r.id)).toEqual([custom.id])

    await expect(deleteCustomRule(OWNER, checkRowId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(
      (await listCheckAlerts(OWNER)).find((c) => c.checkId === 'max-parts')
    ).toMatchObject({ name: renamed.name, source: 'd1' })

    await loadCustomRulesIntoRegistry()
    const ids = ruleRegistry.getAll().map((r) => r.id)
    expect(ids).toContain(custom.id)
    expect(ids).not.toContain(checkRowId)
  })
})

describe('check-alerts API', () => {
  test('a rename never resets an ACK: the returned ruleId still finds it', async () => {
    // The ack route stores every ACK under owner '' (ACK_OWNER_ID).
    await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'max-parts',
      durationKey: '60m',
      ackedBy: 'operator',
    })
    expect((await listActiveAcks('')).map((a) => a.ruleId)).toEqual([
      'max-parts',
    ])

    const res = await handlePut('max-parts', putRequest({ name: 'Parts' }))
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as {
      data: { ruleId: string; name: string }
    }
    expect(data.ruleId).toBe('max-parts')
    expect(data.name).toBe('Parts')

    const acks = await listActiveAcks('')
    expect(acks.some((a) => a.hostId === 0 && a.ruleId === data.ruleId)).toBe(
      true
    )
  })

  test('GET lists every check; unknown ids 404; bad names 400', async () => {
    const res = await handleGet()
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { checkId: string }[] }
    expect(data).toHaveLength(KNOWN_ID_COUNT)

    expect((await handlePut('nope', putRequest({ name: 'x' }))).status).toBe(
      404
    )
    expect(
      (await handlePut('max-parts', putRequest({ name: '' }))).status
    ).toBe(400)
    expect((await handlePut('max-parts', putRequest({}))).status).toBe(400)
    expect((await handleDelete('max-parts')).status).toBe(200)
  })

  test('no metadata DB: GET still lists defaults, writes answer 501', async () => {
    fakeDb = null
    const res = await handleGet()
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as {
      data: { source: string }[]
    }
    expect(data).toHaveLength(KNOWN_ID_COUNT)
    expect(data.every((c) => c.source === 'default')).toBe(true)

    expect(
      (await handlePut('max-parts', putRequest({ name: 'x' }))).status
    ).toBe(501)
    expect((await handleDelete('max-parts')).status).toBe(501)
  })
})

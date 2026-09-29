/**
 * #3493 — the twelve health/alert stores against a REAL Postgres, through
 * their public APIs. Opt-in: set `CHM_TEST_POSTGRES_URL` to a throwaway
 * database (the test creates the tables and deletes its own rows). Skipped
 * otherwise, because CI has no Postgres service for the unit job.
 *
 *   docker run -d --rm -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:16-alpine
 *   CHM_TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:55432/postgres \
 *     bun test src/lib/health/sql-db.postgres.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

const url = process.env.CHM_TEST_POSTGRES_URL
const OWNER = `pg-test-${Date.now()}`
const HOST = 900_000 + Math.floor(Math.random() * 1000)

describe.skipIf(!url)('health stores on Postgres (#3493)', () => {
  const saved = process.env.DATABASE_URL

  beforeAll(() => {
    process.env.DATABASE_URL = url
  })

  afterAll(async () => {
    const { default: postgres } = await import('postgres')
    const sql = postgres(url as string, { max: 1, onnotice: () => {} })
    for (const table of [
      'alert_routes',
      'alert_channel_config',
      'alert_acks',
      'alert_digest_buffer',
      'alert_suggestion_dismissals',
      'alert_webhook_targets',
      'custom_alert_rules',
      'maintenance_windows',
      'quiet_hours',
    ]) {
      await sql.unsafe(`DELETE FROM ${table} WHERE owner_id = $1`, [OWNER])
    }
    await sql.unsafe('DELETE FROM alert_state WHERE host_id = $1', [HOST])
    await sql.unsafe('DELETE FROM alert_events WHERE host_id = $1', [HOST])
    await sql.end()
    if (saved === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = saved
  })

  test('resolver picks Postgres', async () => {
    const { resolveHealthBackend } = await import('./resolve-store')
    expect(resolveHealthBackend()).toBe('postgres')
  })

  test('alert-routing: create / list / delete', async () => {
    const m = await import('./alert-routing')
    const route = await m.createRoute({
      ownerId: OWNER,
      matchRule: 'disk-*',
      matchHost: '*',
      channelUrl: 'https://hooks.example.com/x',
      minSeverity: 'critical',
    })
    expect(route).not.toBeNull()
    const list = await m.listRoutes(OWNER)
    expect(list).toHaveLength(1)
    expect(list[0].enabled).toBe(true)
    expect(list[0].minSeverity).toBe('critical')
    expect(typeof list[0].createdAt).toBe('number')
    expect(await m.deleteRoute(OWNER, list[0].id)).toBe(true)
    expect(await m.listRoutes(OWNER)).toHaveLength(0)
  })

  test('alert-channel-config: upsert keeps secret when blank', async () => {
    const m = await import('./alert-channel-config-store')
    await m.upsertChannelConfig({
      ownerId: OWNER,
      channel: 'telegram',
      enabled: true,
      target: { chatId: '1' },
      secret: 'tok',
    })
    const updated = await m.upsertChannelConfig({
      ownerId: OWNER,
      channel: 'telegram',
      enabled: false,
      target: { chatId: '2' },
      secret: '',
    })
    expect(updated?.secret).toBe('tok')
    expect(updated?.enabled).toBe(false)
    expect(updated?.target).toEqual({ chatId: '2' })
    expect(typeof updated?.updatedAt).toBe('number')
    expect(await m.deleteChannelConfig(OWNER, 'telegram')).toBe(true)
  })

  test('alert-digest-settings: set / get (shares alert_channel_config)', async () => {
    const m = await import('./alert-digest-settings-store')
    await m.setDigestSettings(OWNER, { enabled: true, windowMinutes: 15 })
    expect(await m.getDigestSettings(OWNER)).toEqual({
      enabled: true,
      windowMinutes: 15,
    })
  })

  test('alert-state-persist: flush / read / hydrate round-trip with ms timestamps', async () => {
    const m = await import('./alert-state-persist')
    const { MemoryAlertStateStore, alertStateKey } = await import(
      './alert-state-store'
    )
    const now = Date.now()
    const store = new MemoryAlertStateStore()
    store.set(alertStateKey(HOST, 'disk-usage'), {
      severity: 'critical',
      updatedAt: now,
      notifiedAt: now,
      firstFiredAt: now - 1000,
    })
    await m.flushAlertState(store)
    const rows = await m.readAlertStates(HOST)
    expect(rows).toHaveLength(1)
    expect(rows[0].updatedAt).toBe(now)
    expect(rows[0].firstFiredAt).toBe(now - 1000)

    const fresh = new MemoryAlertStateStore()
    await m.hydrateAlertState(fresh)
    expect(fresh.get(alertStateKey(HOST, 'disk-usage'))?.notifiedAt).toBe(now)
  })

  test('alert-history: record / query by host and day', async () => {
    const m = await import('./alert-history-store')
    const eventTime = new Date().toISOString()
    await m.recordAlertEvent({
      eventTime,
      hostId: HOST,
      rule: 'disk-usage',
      severity: 'critical',
      decisionKind: 'new',
      delivered: true,
      value: 97.5,
      findingRefs: [`${HOST}:disk-usage`],
    })
    const events = await m.queryAlertEvents({
      hostId: HOST,
      day: eventTime.slice(0, 10),
    })
    expect(events).toHaveLength(1)
    expect(events[0].delivered).toBe(true)
    expect(events[0].value).toBe(97.5)
    expect(events[0].findingRefs).toEqual([`${HOST}:disk-usage`])
  })

  test('alert-ack: ack / list active / clear', async () => {
    const m = await import('./alert-ack-store')
    const now = Date.now()
    await m.ackAlert({
      ownerId: OWNER,
      hostId: HOST,
      ruleId: 'disk-usage',
      durationKey: '15m',
      ackedBy: 'me',
      now,
    })
    const acks = await m.listActiveAcks(OWNER, now)
    expect(acks).toHaveLength(1)
    expect(acks[0].expiresAt).toBe(now + 15 * 60 * 1000)
    await m.clearAck(OWNER, HOST, 'disk-usage')
    expect(await m.listActiveAcks(OWNER, now)).toHaveLength(0)
  })

  test('alert-digest-buffer: atomic batch insert, take due once', async () => {
    const m = await import('./alert-digest-buffer-store')
    const payload = { hostId: HOST } as never
    const ok = await m.bufferDigestEntries(
      OWNER,
      [
        { kind: 'telegram', botToken: 't', chatId: '1', payload },
        { kind: 'telegram', botToken: 't', chatId: '2', payload },
      ],
      Date.now() - 1
    )
    expect(ok).toBe(true)
    const due = await m.takeDueDigestEntries(OWNER, Date.now())
    expect(due.map((e) => (e as { chatId: string }).chatId).sort()).toEqual([
      '1',
      '2',
    ])
    expect(await m.takeDueDigestEntries(OWNER, Date.now())).toHaveLength(0)
  })

  test('alert-suggestion-dismissals: idempotent dismiss', async () => {
    const m = await import('./alert-suggestion-dismissals-store')
    await m.dismissSuggestion(OWNER, 'k1')
    await m.dismissSuggestion(OWNER, 'k1')
    expect([...(await m.listDismissedSuggestionKeys(OWNER))]).toEqual(['k1'])
  })

  test('custom-webhook-targets: upsert keeps url when blank, delete', async () => {
    const m = await import('./custom-webhook-target-store')
    await m.upsertCustomWebhookTarget({
      ownerId: OWNER,
      id: 't1',
      name: 'Ops',
      url: 'https://hooks.example.com/secret',
      enabled: true,
      format: 'auto',
    })
    const updated = await m.upsertCustomWebhookTarget({
      ownerId: OWNER,
      id: 't1',
      name: 'Ops 2',
      url: '',
      enabled: false,
      format: 'auto',
    })
    expect(updated?.name).toBe('Ops 2')
    const list = await m.listCustomWebhookTargets(OWNER)
    expect(list).toHaveLength(1)
    expect(await m.deleteCustomWebhookTarget(OWNER, 't1')).toBe(true)
  })

  test('custom-rules: create / list / delete (meta.changes → NOT_FOUND)', async () => {
    const m = await import('./custom-rules-store')
    const rule = await m.createCustomRule(OWNER, {
      name: 'Mutations',
      metric: 'active-mutations',
      op: '>',
      warning: 1.5,
      critical: 10,
    })
    const list = await m.listCustomRules(OWNER)
    expect(list).toHaveLength(1)
    expect(list[0].warning).toBe(1.5)
    expect(list[0].enabled).toBe(true)
    await m.deleteCustomRule(OWNER, rule.id)
    await expect(m.deleteCustomRule(OWNER, rule.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  test('maintenance-windows: create / list / delete', async () => {
    const m = await import('./maintenance-windows')
    const now = Date.now()
    const w = await m.createWindow({
      ownerId: OWNER,
      hostId: null,
      reason: 'upgrade',
      startsAt: now,
      endsAt: now + 60_000,
      createdBy: 'me',
    })
    const list = await m.listWindows(OWNER)
    expect(list.map((x) => x.id)).toContain(w.id)
    expect(m.isSuppressed(list, HOST, now + 1)).toBe(true)
    await m.deleteWindow(OWNER, w.id)
  })

  test('quiet-hours: create / list / delete', async () => {
    const m = await import('./quiet-hours')
    const q = await m.createQuietHours({
      ownerId: OWNER,
      days: [1, 2],
      start: '22:00',
      end: '06:00',
      timezone: 'UTC',
      severityCap: null,
      createdBy: 'me',
    })
    const list = await m.listQuietHours(OWNER)
    expect(list.map((x) => x.id)).toContain(q.id)
    await m.deleteQuietHours(OWNER, q.id)
  })
})

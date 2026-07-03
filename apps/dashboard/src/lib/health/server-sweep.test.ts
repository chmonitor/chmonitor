/**
 * Tests for the alert-history hook in the health sweep.
 *
 * Two layers:
 *  1. `buildAlertEventRecord` — a pure decision→record mapping, unit-tested
 *     directly (no mocking) to lock down the trickiest translation: recovery
 *     carries its own 'recovery' severity (not the decision's 'ok'), and a
 *     previousSeverity of 'ok' (no prior firing condition) maps to `null`.
 *  2. `runHealthSweep` end-to-end — proves the hook is wired at the right
 *     point in server-sweep.ts and fires exactly once per dispatched alert,
 *     with the real decision + delivery outcome, on BOTH a successful and a
 *     failed webhook delivery (`delivered`/`error` only mean something if
 *     both paths are exercised).
 *
 * `@chm/clickhouse-client` is mocked so every rule's SQL resolves to a safe
 * "ok" value EXCEPT a synthetic test-only rule (tagged with a unique SQL
 * marker), which is the only one allowed to fire — this keeps the test
 * independent of the real builtin rules' thresholds/SQL.
 */

import type { AlertDecision } from './alert-state-store'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// --- fake D1 (captures INSERTs from recordAlertEvent) -----------------------
interface FakeRow {
  id: string
  event_time: string
  host_id: number
  host_label: string | null
  rule: string
  severity: string
  prev_severity: string | null
  decision_kind: string
  delivered: number
  error: string | null
  value: number | null
  channel: string | null
}

function makeFakeD1() {
  const rows: FakeRow[] = []
  return {
    rows,
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run(): Promise<{ meta: { changes: number } }> {
              const [
                id,
                eventTime,
                hostId,
                hostLabel,
                rule,
                severity,
                prevSeverity,
                decisionKind,
                delivered,
                error,
                value,
                channel,
              ] = args as [
                string,
                string,
                number,
                string | null,
                string,
                string,
                string | null,
                string,
                number,
                string | null,
                number | null,
                string | null,
              ]
              rows.push({
                id,
                event_time: eventTime,
                host_id: hostId,
                host_label: hostLabel,
                rule,
                severity,
                prev_severity: prevSeverity,
                decision_kind: decisionKind,
                delivered,
                error,
                value,
                channel,
              })
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}

let fakeDb: ReturnType<typeof makeFakeD1>

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => fakeDb,
  }),
}))

// --- synthetic rule + ClickHouse stubs --------------------------------------
const TEST_RULE_MARKER = '__TEST_SWEEP_MARKER__'
const TEST_RULE_ID = 'test-sweep-rule'

let testValue = 50

const mockFetchData = mock(async ({ query }: { query: string }) => {
  if (query.includes(TEST_RULE_MARKER)) {
    return { data: [{ test_value: testValue }], error: null }
  }
  // Every builtin rule + the system.tables probe: an empty/zero-ish row,
  // which classifies as 'ok' for every real rule's (>= 1) thresholds.
  return { data: [{}], error: null }
})

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
  getClickHouseConfigs: () => [
    { id: 0, host: 'test-host', user: 'default', password: '' },
  ],
}))

mock.module('@/lib/insights/generate-insights', () => ({
  generateInsights: async () => [],
}))

const { alertStateStore } = await import('./alert-state-store')
const { ruleRegistry } = await import('@/lib/alerting/rule-registry')
const { buildAlertEventRecord, runHealthSweep } = await import('./server-sweep')

ruleRegistry.register({
  id: TEST_RULE_ID,
  type: 'custom',
  title: 'Test Sweep Rule',
  description: 'Synthetic rule for server-sweep.test.ts',
  sql: `SELECT 1 /* ${TEST_RULE_MARKER} */`,
  valueKey: 'test_value',
  defaults: { warning: 10, critical: 20 },
})

const ENV_KEYS = [
  'HEALTH_ALERT_ENABLED',
  'HEALTH_ALERT_WEBHOOK_URL',
  'HEALTH_ALERT_MIN_SEVERITY',
] as const
const savedEnv: Record<string, string | undefined> = {}

let fetchCalls: { status: number }[] = []

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.HEALTH_ALERT_ENABLED = 'true'
  process.env.HEALTH_ALERT_WEBHOOK_URL =
    'https://hooks.slack.com/services/T000/B000/XXXX'
  process.env.HEALTH_ALERT_MIN_SEVERITY = 'warning'

  alertStateStore.clear()
  fakeDb = makeFakeD1()
  testValue = 50
  fetchCalls = []
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

// ---------------------------------------------------------------------------
// buildAlertEventRecord — pure mapping
// ---------------------------------------------------------------------------
describe('buildAlertEventRecord', () => {
  const decision = (over: Partial<AlertDecision>): AlertDecision => ({
    notify: true,
    kind: 'new',
    severity: 'critical',
    previousSeverity: 'ok',
    ...over,
  })

  test('a brand-new alert (ok -> critical): severity=critical, prevSeverity=null', () => {
    const record = buildAlertEventRecord({
      hostId: 0,
      hostLabel: 'prod-ch',
      ruleId: 'disk-usage',
      decision: decision({
        kind: 'new',
        severity: 'critical',
        previousSeverity: 'ok',
      }),
      value: 97,
      delivered: true,
      channel: 'slack',
      now: 1_700_000_000_000,
    })

    expect(record.severity).toBe('critical')
    expect(record.prevSeverity).toBeNull()
    expect(record.decisionKind).toBe('new')
    expect(record.delivered).toBe(true)
    expect(record.error).toBeNull()
    expect(record.value).toBe(97)
    expect(record.channel).toBe('slack')
    expect(record.eventTime).toBe(new Date(1_700_000_000_000).toISOString())
  })

  test('escalation (warning -> critical): prevSeverity carries the prior firing severity', () => {
    const record = buildAlertEventRecord({
      hostId: 0,
      hostLabel: 'prod-ch',
      ruleId: 'disk-usage',
      decision: decision({
        kind: 'escalated',
        severity: 'critical',
        previousSeverity: 'warning',
      }),
      value: 99,
      delivered: true,
      channel: 'slack',
    })

    expect(record.severity).toBe('critical')
    expect(record.prevSeverity).toBe('warning')
    expect(record.decisionKind).toBe('escalated')
  })

  test('recovery: severity is "recovery" (not the decision\'s "ok"), prevSeverity is the resolved condition', () => {
    const record = buildAlertEventRecord({
      hostId: 0,
      hostLabel: 'prod-ch',
      ruleId: 'disk-usage',
      decision: decision({
        kind: 'recovery',
        severity: 'ok',
        previousSeverity: 'critical',
      }),
      value: 10,
      delivered: true,
      channel: 'slack',
    })

    expect(record.severity).toBe('recovery')
    expect(record.prevSeverity).toBe('critical')
    expect(record.decisionKind).toBe('recovery')
  })

  test('a failed delivery carries delivered=false and the error message', () => {
    const record = buildAlertEventRecord({
      hostId: 0,
      hostLabel: 'prod-ch',
      ruleId: 'disk-usage',
      decision: decision({
        kind: 'new',
        severity: 'warning',
        previousSeverity: 'ok',
      }),
      value: 12,
      delivered: false,
      error: 'Webhook returned status 500',
      channel: 'slack',
    })

    expect(record.delivered).toBe(false)
    expect(record.error).toBe('Webhook returned status 500')
  })
})

// ---------------------------------------------------------------------------
// runHealthSweep — end-to-end hook wiring
// ---------------------------------------------------------------------------
describe('runHealthSweep — alert-history hook', () => {
  test('a dispatched (delivered) alert produces exactly one alert_events row', async () => {
    globalThis.fetch = mock(async () => {
      fetchCalls.push({ status: 200 })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(fakeDb.rows).toHaveLength(1)

    const [row] = fakeDb.rows
    expect(row.host_id).toBe(0)
    expect(row.host_label).toBe('test-host')
    expect(row.rule).toBe(TEST_RULE_ID)
    expect(row.severity).toBe('critical')
    expect(row.prev_severity).toBeNull()
    expect(row.decision_kind).toBe('new')
    expect(row.delivered).toBe(1)
    expect(row.error).toBeNull()
    expect(row.value).toBe(50)
    // detectAdapter() correctly identifies the slack webhook URL.
    expect(row.channel).toBe('slack')
  })

  test('a failed delivery still produces one row, with delivered=0 and the error message', async () => {
    globalThis.fetch = mock(async () => {
      fetchCalls.push({ status: 500 })
      return new Response(null, { status: 500 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // Delivery failed, so the sweep does not count it as dispatched (retries
    // next sweep instead of being suppressed by the dedup cooldown).
    expect(summary.alertsDispatched).toBe(0)
    expect(fakeDb.rows).toHaveLength(1)

    const [row] = fakeDb.rows
    expect(row.delivered).toBe(0)
    expect(row.error).toBe('Webhook returned status 500')
    expect(row.decision_kind).toBe('new')
  })

  test('a D1 write failure during recordAlertEvent never throws into the sweep', async () => {
    // Simulate the store's own D1 call throwing (e.g. table not migrated
    // yet) — the sweep must still complete and still count the delivery.
    fakeDb = {
      rows: [],
      prepare() {
        throw new Error('boom: D1 unavailable')
      },
    } as unknown as ReturnType<typeof makeFakeD1>

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
  })
})

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

/** A pre-configured `alert_routes` row, as `alert-routing.ts`'s `listRoutes` reads it. */
interface FakeRouteRow {
  id: string
  owner_id: string
  match_rule: string
  match_host: string
  channel_url: string
  enabled: number
  created_at: number
}

/**
 * `routes` seeds what the SELECT in `alert-routing.ts` (`listRoutes`) returns,
 * so tests can exercise the sweep's fan-out over ≥1 configured routes — every
 * other test in this file passes no routes, which only exercises the legacy
 * global-webhook fallback (`resolveTargets` sees `[]` and falls back).
 * `prepare()` branches on the SQL's target table, mirroring
 * `alert-routing.test.ts`'s fake-D1 pattern.
 */
function makeFakeD1(routes: FakeRouteRow[] = []) {
  const rows: FakeRow[] = []
  return {
    rows,
    prepare(sql: string) {
      const isRoutesSelect = /FROM alert_routes/i.test(sql)
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
            async all<T>(): Promise<{ results: T[] }> {
              return { results: (isRoutesSelect ? routes : []) as T[] }
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
// A second, always-ok, non-optional synthetic base rule — used as a compound
// rule dependency below. Every real builtin rule is `optional: true` with a
// `tableCheck`, and the fake `system.tables` probe response never contains a
// real table name, so builtin rules are always skipped in this suite; a
// compound rule that depended on one would never see its dependency run.
const TEST_RULE_ID_2 = 'test-sweep-rule-2'

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
const { compoundRuleRegistry } = await import('@/lib/alerting/compound-rules')
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

ruleRegistry.register({
  id: TEST_RULE_ID_2,
  type: 'custom',
  title: 'Test Sweep Rule 2',
  description: 'Second synthetic (always-ok) rule for compound-rule tests.',
  sql: `SELECT 0 AS always_ok_value`,
  valueKey: 'always_ok_value',
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

  test('a matched route fans out to its channel INSTEAD OF the legacy webhook', async () => {
    fakeDb = makeFakeD1([
      {
        id: 'route-1',
        owner_id: '',
        match_rule: TEST_RULE_ID,
        match_host: '*',
        channel_url: 'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
        enabled: 1,
        created_at: 0,
      },
    ])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    // Exactly one delivery — to the matched route's channel, not the legacy
    // global URL (env HEALTH_ALERT_WEBHOOK_URL) — matched routes take
    // precedence, the legacy URL is a fallback only when nothing matches.
    expect(posted).toEqual([
      'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
    ])
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.rows[0].channel).toBe('slack')
  })

  test('two matched routes fan out to both channels, but dedup evaluates the condition only ONCE', async () => {
    fakeDb = makeFakeD1([
      {
        id: 'route-1',
        owner_id: '',
        match_rule: '*',
        match_host: '*',
        channel_url: 'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
        enabled: 1,
        created_at: 0,
      },
      {
        id: 'route-2',
        owner_id: '',
        match_rule: '*',
        match_host: '*',
        channel_url: 'https://discord.com/api/webhooks/1/abc',
        enabled: 1,
        created_at: 0,
      },
    ])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const first = await runHealthSweep()

    // One finding, two matched channels: two deliveries, two audit rows —
    // but the sweep's summary still counts ONE dispatched alert (the
    // finding-level decision), and each channel got its own row.
    expect(first.alertsDispatched).toBe(1)
    expect(posted).toHaveLength(2)
    expect(posted.sort()).toEqual(
      [
        'https://discord.com/api/webhooks/1/abc',
        'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
      ].sort()
    )
    expect(fakeDb.rows).toHaveLength(2)
    expect(fakeDb.rows.map((r) => r.channel).sort()).toEqual([
      'discord',
      'slack',
    ])
    // Every row shares the same decision (fan-out didn't fork the decision
    // per channel): both are the 'new' notify for this finding.
    for (const row of fakeDb.rows) {
      expect(row.decision_kind).toBe('new')
      expect(row.delivered).toBe(1)
    }

    // STOP condition: evaluateAlert ran ONCE for this finding, not once per
    // channel — a second sweep of the same persistent condition must be
    // suppressed by dedup/cooldown (no further deliveries), not fire again
    // per matched channel.
    posted.length = 0
    fakeDb.rows.length = 0
    const second = await runHealthSweep()
    expect(second.alertsDispatched).toBe(0)
    expect(posted).toHaveLength(0)
  })

  test('no route matches and no legacy URL configured -> no delivery, but the condition still commits', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = ''
    fakeDb = makeFakeD1([
      {
        id: 'route-1',
        owner_id: '',
        match_rule: 'unrelated-rule-id',
        match_host: '*',
        channel_url: 'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
        enabled: 1,
        created_at: 0,
      },
    ])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(posted).toHaveLength(0)
    expect(summary.alertsDispatched).toBe(0)
    expect(fakeDb.rows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// runHealthSweep — compound rules (plan 31)
// ---------------------------------------------------------------------------
describe('runHealthSweep — compound rules', () => {
  afterEach(() => {
    compoundRuleRegistry.unregister('throwing-compound-rule')
    compoundRuleRegistry.unregister('test-compound-rule')
  })

  test('a throwing compound rule never breaks base-rule evaluation or dispatch', async () => {
    compoundRuleRegistry.register({
      id: 'throwing-compound-rule',
      title: 'Throwing Compound Rule',
      description: 'Always throws — proves fail-open.',
      depends: [TEST_RULE_ID, TEST_RULE_ID_2],
      evaluate: () => {
        throw new Error('boom: compound predicate exploded')
      },
    })

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // The base test rule still fired and dispatched normally.
    expect(summary.alertsDispatched).toBe(1)
    const host = summary.hosts[0]
    expect(host.errored).toBeGreaterThanOrEqual(1)
  })

  test('a compound rule fires and dedups under its own hostId:compoundId key', async () => {
    compoundRuleRegistry.register({
      id: 'test-compound-rule',
      title: 'Test Compound Rule',
      description: 'Fires whenever the test base rule fires.',
      depends: [TEST_RULE_ID, TEST_RULE_ID_2],
      evaluate: (inputs) =>
        inputs[TEST_RULE_ID]?.severity === 'critical' ? 'critical' : 'ok',
    })

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // Base rule + compound rule both dispatched, each under its own dedup key.
    expect(summary.alertsDispatched).toBe(2)
    const rules = fakeDb.rows.map((r) => r.rule).sort()
    expect(rules).toEqual(['test-compound-rule', TEST_RULE_ID].sort())

    expect(alertStateStore.get(`0:test-compound-rule`)?.severity).toBe(
      'critical'
    )
    // Base rule's own dedup identity is untouched by the compound rule.
    expect(alertStateStore.get(`0:${TEST_RULE_ID}`)?.severity).toBe('critical')
  })

  test("a compound-on-compound dependency sees its upstream compound rule's result", async () => {
    compoundRuleRegistry.register({
      id: 'test-compound-rule',
      title: 'Test Compound Rule',
      description: 'Fires whenever the test base rule fires.',
      depends: [TEST_RULE_ID, TEST_RULE_ID_2],
      evaluate: (inputs) =>
        inputs[TEST_RULE_ID]?.severity === 'critical' ? 'critical' : 'ok',
    })
    compoundRuleRegistry.register({
      id: 'test-compound-of-compound',
      title: 'Test Compound-of-Compound',
      description: 'Depends on another compound rule, not just base rules.',
      depends: ['test-compound-rule'],
      evaluate: (inputs) => inputs['test-compound-rule']?.severity ?? 'ok',
    })

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // Base rule + both compound rules dispatched, each under its own key.
    expect(summary.alertsDispatched).toBe(3)
    expect(alertStateStore.get('0:test-compound-of-compound')?.severity).toBe(
      'critical'
    )

    compoundRuleRegistry.unregister('test-compound-of-compound')
  })
})

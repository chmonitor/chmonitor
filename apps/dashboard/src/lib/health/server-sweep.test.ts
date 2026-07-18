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

import { installHealthPlatformMock } from './__tests__/platform-mock'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { createHmac } from 'node:crypto'

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
  /** #2663: JSON `"hostId:ruleId"` refs for a grouped digest row, else null. */
  finding_refs: string | null
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
  /** plan 34: defaults to 'webhook' when omitted, matching a pre-migration row. */
  provider?: string
  service_name?: string | null
  routing_key?: string | null
  /** #2661: per-route severity floor; absent = inherit (null). */
  min_severity?: string | null
}

/**
 * A pre-configured `webhook_subscriptions` row, as `subscription-store.ts`'s
 * `listInstanceScopedSubscriptionsForEvent` (#2664) reads it.
 */
interface FakeInstanceSubscriptionRow {
  id: string
  user_id: string
  url: string
  secret: string
  event_types: string
  enabled: number
  scope: string
  created_at: number
  updated_at: number
}

/** One captured `webhook_deliveries` INSERT — the outbound bus's audit log. */
interface FakeDeliveryRow {
  id: string
  subscription_id: string
  event_type: string
  status: string
  attempts: number
  last_status_code: number | null
  last_error: string | null
  event_time: number
  delivered_at: number | null
}

/**
 * `routes` seeds what the SELECT in `alert-routing.ts` (`listRoutes`) returns,
 * so tests can exercise the sweep's fan-out over ≥1 configured routes — every
 * other test in this file passes no routes, which only exercises the legacy
 * global-webhook fallback (`resolveTargets` sees `[]` and falls back).
 * `instanceSubs` seeds the webhook-subscriptions bus's instance-scoped read
 * (`subscription-store.ts`'s `D1_LIST_INSTANCE_SCOPED_SQL`, #2664) — every
 * other test passes none, so `emitInstanceEvent` sees zero subscribers and
 * no-ops (proving the bus's presence never affects legacy-channel behavior).
 * `prepare()` branches on the SQL's target table, mirroring
 * `alert-routing.test.ts`'s fake-D1 pattern. Deliveries recorded against
 * `webhook_deliveries` (the outbound bus's own audit log) are captured
 * SEPARATELY from `rows` (`alert_events`, the legacy alert-history log) so
 * the two INSERT shapes — very different column layouts — can never be
 * cross-contaminated.
 */
function makeFakeD1(
  routes: FakeRouteRow[] = [],
  instanceSubs: FakeInstanceSubscriptionRow[] = []
) {
  const rows: FakeRow[] = []
  const deliveries: FakeDeliveryRow[] = []
  // #2663 time-window digest buffer rows (INTO/FROM alert_digest_buffer).
  const bufferRows: {
    id: string
    owner_id: string
    flush_after: number
    entry_json: string
    created_at: number
  }[] = []
  return {
    rows,
    deliveries,
    bufferRows,
    // Real D1-backed stores the sweep touches (e.g. quiet-hours) run their
    // lazy DDL migration via `db.batch(...)` before reading. Without this,
    // `db.batch` throws SYNCHRONOUSLY inside their single-flight
    // `ensureMigrated`, which permanently caches the rejected migration
    // promise (the `migration = null` reset runs before the outer assignment)
    // and poisons those stores for every later suite in the same bun process.
    // The digest buffer store inserts via `db.batch(boundStmts)` (atomic,
    // all-or-nothing), so bound statements must actually execute; DDL/other
    // statements the fake doesn't model still resolve to a no-op result.
    batch: async (stmts: unknown[]) =>
      Promise.all(
        stmts.map(async (s) => {
          const runnable = s as { run?: () => Promise<unknown> }
          if (typeof runnable.run !== 'function') {
            return { meta: { changes: 0 } }
          }
          try {
            return await runnable.run()
          } catch {
            return { meta: { changes: 0 } }
          }
        })
      ),
    prepare(sql: string) {
      const isRoutesSelect = /FROM alert_routes/i.test(sql)
      const isSubscriptionsSelect = /FROM webhook_subscriptions/i.test(sql)
      const isDeliveryInsert = /INTO webhook_deliveries/i.test(sql)
      const isBufferInsert = /INTO alert_digest_buffer/i.test(sql)
      const isBufferSelect = /FROM alert_digest_buffer/i.test(sql)
      const isBufferDelete = /DELETE FROM alert_digest_buffer/i.test(sql)
      const isEventsInsert = /INTO alert_events/i.test(sql)

      // Shared run()/all() so both the unbound statement (real D1 supports
      // calling `.run()`/`.all()` directly when the SQL has no `?`
      // placeholders — see e.g. `alert-suggestion-dismissals-store.ts`'s
      // `db.prepare(MIGRATION_SQL).run()`, and `subscription-store.ts`'s
      // `D1_LIST_INSTANCE_SCOPED_SQL` read, #2664) and the `.bind(...args)`
      // form behave identically.
      async function run(
        args: unknown[]
      ): Promise<{ meta: { changes: number } }> {
        if (isBufferDelete) {
          const ids = new Set(args as string[])
          const before = bufferRows.length
          for (let i = bufferRows.length - 1; i >= 0; i--) {
            if (ids.has(bufferRows[i].id)) bufferRows.splice(i, 1)
          }
          return { meta: { changes: before - bufferRows.length } }
        }
        if (isBufferInsert) {
          const [id, ownerId, flushAfter, entryJson, createdAt] = args as [
            string,
            string,
            number,
            string,
            number,
          ]
          bufferRows.push({
            id,
            owner_id: ownerId,
            flush_after: flushAfter,
            entry_json: entryJson,
            created_at: createdAt,
          })
          return { meta: { changes: 1 } }
        }
        if (isDeliveryInsert) {
          const [
            id,
            subscriptionId,
            eventType,
            status,
            attempts,
            lastStatusCode,
            lastError,
            eventTime,
            deliveredAt,
          ] = args as [
            string,
            string,
            string,
            string,
            number,
            number | null,
            string | null,
            number,
            number | null,
          ]
          deliveries.push({
            id,
            subscription_id: subscriptionId,
            event_type: eventType,
            status,
            attempts,
            last_status_code: lastStatusCode,
            last_error: lastError,
            event_time: eventTime,
            delivered_at: deliveredAt,
          })
          return { meta: { changes: 1 } }
        }
        // Anything else the fake doesn't model (e.g. lazy DDL migrations that
        // now actually execute through `batch`) is a harmless no-op — only a
        // real alert_events insert may write into `rows`.
        if (!isEventsInsert) return { meta: { changes: 0 } }
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
          findingRefs,
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
          finding_refs: findingRefs ?? null,
        })
        return { meta: { changes: 1 } }
      }

      async function all<T>(
        boundArgs: unknown[] = []
      ): Promise<{ results: T[] }> {
        if (isSubscriptionsSelect) {
          return { results: instanceSubs as T[] }
        }
        if (isBufferSelect) {
          const [ownerId, now] = boundArgs as [string, number]
          return {
            results: bufferRows
              .filter((r) => r.owner_id === ownerId && r.flush_after <= now)
              .sort((a, b) => a.flush_after - b.flush_after) as unknown as T[],
          }
        }
        return { results: (isRoutesSelect ? routes : []) as T[] }
      }

      return {
        run: () => run([]),
        all: () => all([]),
        bind(...args: unknown[]) {
          return {
            run: () => run(args),
            all: () => all(args),
          }
        },
      }
    },
  }
}

let fakeDb: ReturnType<typeof makeFakeD1>

installHealthPlatformMock(() => fakeDb)

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

// Same reason as generate-insights above: the sweep now also generates Postgres
// insights, and the real module transitively imports the insights store chain
// (→ @chm/clickhouse-client `getClient`), which the CH mock above does not
// provide. Stub it at the boundary so the sweep test stays hermetic.
mock.module('@/lib/insights/generate-postgres-insights', () => ({
  generatePostgresInsights: async () => [],
}))

// --- maintenance windows stub ------------------------------------------------
// Mocked at the module boundary (like generate-insights above) rather than
// routed through the shared fake D1: the sweep only depends on
// `listWindows`/`isSuppressed`'s CONTRACT here, not the D1 storage details
// already covered by maintenance-windows.test.ts.
interface MockWindow {
  hostId: number | null
  startsAt: number
  endsAt: number
}
let mockWindows: MockWindow[] = []

// Capture the REAL modules before mocking them so afterAll can restore them.
// bun's `mock.module` patches the module registry for the whole test process,
// so without a restore these mocks leak into maintenance-windows.test.ts and
// alert-ack-store.test.ts when the directory runs in a single `bun test`
// invocation (issue #2672). The eager `{ ...spread }` matters: mock.module
// live-patches the captured namespace OBJECT too, so spreading lazily at
// restore time would "restore" the mocks — snapshot the real exports now.
const realMaintenanceWindows = { ...(await import('./maintenance-windows')) }
const realAlertAckStore = { ...(await import('./alert-ack-store')) }

mock.module('@/lib/health/maintenance-windows', () => ({
  listWindows: async (_ownerId: string) => mockWindows,
  isSuppressed: (windows: MockWindow[], hostId: number, now: number) =>
    windows.some(
      (w) =>
        (w.hostId === null || w.hostId === hostId) &&
        w.startsAt <= now &&
        now < w.endsAt
    ),
}))

// --- ACK store mock (plan 29) ------------------------------------------------
// Controllable in-memory acks list + a spy on clearAck, so tests can assert
// the sweep's suppression/recovery-clear branch without D1.
interface FakeAck {
  hostId: number
  ruleId: string
  expiresAt: number
}
let activeAcks: FakeAck[] = []
const clearAckCalls: { hostId: number; ruleId: string }[] = []

mock.module('./alert-ack-store', () => ({
  listActiveAcks: async () => activeAcks,
  isAcked: (acks: FakeAck[], hostId: number, ruleId: string, now: number) =>
    acks.some(
      (a) => a.hostId === hostId && a.ruleId === ruleId && a.expiresAt > now
    ),
  clearAck: async (_ownerId: string, hostId: number, ruleId: string) => {
    clearAckCalls.push({ hostId, ruleId })
  },
}))

// Restore the real modules once this suite finishes so the mocks above never
// leak into other test files running in the same bun process (issue #2672).
afterAll(() => {
  mock.module('@/lib/health/maintenance-windows', () => ({
    ...realMaintenanceWindows,
  }))
  mock.module('./alert-ack-store', () => ({ ...realAlertAckStore }))
})

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
  'HEALTH_ALERT_PAGERDUTY_ROUTING_KEY',
  'HEALTH_ALERT_HEALTHCHECKS_URL',
  'HEALTH_ALERT_DIGEST_MINUTES',
  'HEALTH_HYSTERESIS_BREACHES',
  'HEALTH_HYSTERESIS_CLEARS',
] as const
const savedEnv: Record<string, string | undefined> = {}

let fetchCalls: { status: number }[] = []

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.HEALTH_ALERT_ENABLED = 'true'
  process.env.HEALTH_ALERT_WEBHOOK_URL =
    'https://hooks.slack.com/services/T000/B000/XXXX'
  process.env.HEALTH_ALERT_MIN_SEVERITY = 'warning'
  // Pin hysteresis OFF (1 breach / 1 clear) for these plumbing tests so a fire
  // and a recovery each land on a single sweep — the anti-flap state machine
  // and the product default (fire=1, clear=2) are covered directly in
  // alert-state-store.test.ts / server-alert-config.test.ts (#2767).
  process.env.HEALTH_HYSTERESIS_BREACHES = '1'
  process.env.HEALTH_HYSTERESIS_CLEARS = '1'
  delete process.env.HEALTH_ALERT_PAGERDUTY_ROUTING_KEY
  delete process.env.HEALTH_ALERT_HEALTHCHECKS_URL
  delete process.env.HEALTH_ALERT_DIGEST_MINUTES

  alertStateStore.clear()
  fakeDb = makeFakeD1()
  testValue = 50
  fetchCalls = []
  mockWindows = []
  activeAcks = []
  clearAckCalls.length = 0
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

  test('a healthchecks.io URL (#2665) pings on an alert alongside the legacy webhook', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = '' // isolate the healthchecks ping
    process.env.HEALTH_ALERT_HEALTHCHECKS_URL = 'https://hc-ping.com/uuid-1234'

    const posted: { url: string; method: string }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init) => {
      posted.push({ url: String(url), method: init?.method ?? 'GET' })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // A critical (>= 20) finding fires an alert → a bare GET to the base ping
    // URL (no `/fail`, which is recovery-only), and the sweep counts it.
    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toEqual([
      { url: 'https://hc-ping.com/uuid-1234', method: 'GET' },
    ])
    expect(fakeDb.rows.map((r) => r.channel)).toEqual(['healthchecks'])
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

  test('a per-route critical floor silences a warning finding (#2661), still commits', async () => {
    // No legacy webhook so the route is the ONLY possible destination.
    process.env.HEALTH_ALERT_WEBHOOK_URL = ''
    // Warning-level finding (10 <= 15 < 20), global gate at 'warning'.
    testValue = 15
    fakeDb = makeFakeD1([
      {
        id: 'route-crit',
        owner_id: '',
        match_rule: TEST_RULE_ID,
        match_host: '*',
        channel_url: 'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
        enabled: 1,
        created_at: 0,
        min_severity: 'critical',
      },
    ])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // The only matching route is critical-only, so it is silenced for this
    // warning — nothing is delivered, but the condition still commits (no
    // eligible destinations counts as "nothing to deliver", not a failure).
    expect(posted).toEqual([])
    expect(summary.alertsDispatched).toBe(0)
  })

  test('a per-route critical floor still delivers a critical finding (#2661)', async () => {
    testValue = 50 // critical (>= 20)
    fakeDb = makeFakeD1([
      {
        id: 'route-crit',
        owner_id: '',
        match_rule: TEST_RULE_ID,
        match_host: '*',
        channel_url: 'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
        enabled: 1,
        created_at: 0,
        min_severity: 'critical',
      },
    ])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toEqual([
      'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
    ])
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

  // -------------------------------------------------------------------------
  // PagerDuty escalation / on-call routing (plan 34)
  // -------------------------------------------------------------------------

  test('a matched pagerduty route posts a real Events API v2 body to the fixed enqueue endpoint', async () => {
    // Isolate the PagerDuty-only delivery: no legacy global webhook so the
    // 'webhook' fallback in resolveTargets contributes nothing here.
    process.env.HEALTH_ALERT_WEBHOOK_URL = ''
    fakeDb = makeFakeD1([
      {
        id: 'pd-route-1',
        owner_id: '',
        match_rule: TEST_RULE_ID,
        match_host: '*',
        channel_url: 'https://events.pagerduty.com/v2/enqueue',
        enabled: 1,
        created_at: 0,
        provider: 'pagerduty',
        service_name: 'DB On-call',
        routing_key: 'R-service-key',
      },
    ])

    const posted: { url: string; body: unknown }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init) => {
      posted.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toHaveLength(1)
    expect(posted[0].url).toBe('https://events.pagerduty.com/v2/enqueue')
    const body = posted[0].body as {
      routing_key: string
      event_action: string
      dedup_key: string
    }
    expect(body.routing_key).toBe('R-service-key')
    expect(body.event_action).toBe('trigger')
    expect(body.dedup_key).toBe(`chmonitor:0:${TEST_RULE_ID}`)
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.rows[0].channel).toBe('pagerduty:DB On-call')
  })

  test('falls back to the env PagerDuty routing key when no route matches', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = ''
    process.env.HEALTH_ALERT_PAGERDUTY_ROUTING_KEY = 'R-env-fallback'

    const posted: { url: string; body: unknown }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init) => {
      posted.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toHaveLength(1)
    expect(posted[0].url).toBe('https://events.pagerduty.com/v2/enqueue')
    expect((posted[0].body as { routing_key: string }).routing_key).toBe(
      'R-env-fallback'
    )
    expect(fakeDb.rows[0].channel).toBe('pagerduty:default')
  })

  test('no pagerduty route/env key configured -> no PagerDuty delivery (only the legacy webhook fires)', async () => {
    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    // Only the legacy global webhook (env HEALTH_ALERT_WEBHOOK_URL) fired —
    // no PagerDuty Events API call since no route or env key is configured.
    expect(posted).toEqual(['https://hooks.slack.com/services/T000/B000/XXXX'])
  })

  test('a matched pagerduty route suppresses the legacy webhook — no double-fire', async () => {
    // Legacy global webhook stays configured (beforeEach default), AND a
    // PagerDuty route matches this finding — the match must win exclusively:
    // PagerDuty pages, the legacy Slack webhook must NOT also fire.
    fakeDb = makeFakeD1([
      {
        id: 'pd-route-1',
        owner_id: '',
        match_rule: TEST_RULE_ID,
        match_host: '*',
        channel_url: 'https://events.pagerduty.com/v2/enqueue',
        enabled: 1,
        created_at: 0,
        provider: 'pagerduty',
        service_name: 'DB On-call',
        routing_key: 'R-service-key',
      },
    ])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toEqual(['https://events.pagerduty.com/v2/enqueue'])
  })

  test('a matched webhook route suppresses the env PagerDuty fallback — no double-fire', async () => {
    // A catch-all webhook route matches AND an env PagerDuty routing key is
    // configured — the explicit webhook route must win exclusively: no
    // PagerDuty Events API call for this finding.
    process.env.HEALTH_ALERT_PAGERDUTY_ROUTING_KEY = 'R-env-fallback'
    fakeDb = makeFakeD1([
      {
        id: 'webhook-route-1',
        owner_id: '',
        match_rule: '*',
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
    expect(posted).toEqual([
      'https://hooks.slack.com/services/ROUTE/CHANNEL/AAA',
    ])
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

    // Base rule + compound rule both dispatched, each under its own dedup key —
    // the sweep counts two findings. Both route to the SAME legacy Slack
    // webhook, so grouping (#2663) folds them into ONE digest message + ONE
    // 'digest' history row that references both findings.
    expect(summary.alertsDispatched).toBe(2)
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.rows[0].rule).toBe('digest')
    expect(fakeDb.rows[0].decision_kind).toBe('digest')
    expect(fakeDb.rows[0].channel).toBe('slack')
    expect(JSON.parse(fakeDb.rows[0].finding_refs ?? '[]').sort()).toEqual(
      [`0:test-compound-rule`, `0:${TEST_RULE_ID}`].sort()
    )

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

// ---------------------------------------------------------------------------
// runHealthSweep — maintenance-window suppression (plan 28)
// ---------------------------------------------------------------------------
describe('runHealthSweep — maintenance window suppression', () => {
  test('an active ALL-hosts window suppresses dispatch and records decisionKind=maintenance', async () => {
    mockWindows = [{ hostId: null, startsAt: 0, endsAt: Date.now() + 60_000 }]

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // Suppressed, not dispatched — no webhook call at all.
    expect(summary.alertsDispatched).toBe(0)
    expect(summary.maintenanceSuppressed).toBe(1)
    expect(summary.alertsSuppressed).toBe(1)
    // The finding itself is still reported (data collection unaffected).
    expect(summary.totalFindings).toBe(1)
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.rows[0]?.decision_kind).toBe('maintenance')
    expect(fakeDb.rows[0]?.delivered).toBe(0)
  })

  test("an active window on a DIFFERENT host does not suppress this host's dispatch", async () => {
    mockWindows = [{ hostId: 999, startsAt: 0, endsAt: Date.now() + 60_000 }]

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(summary.maintenanceSuppressed).toBe(0)
  })

  test('a window outside its time range does not suppress', async () => {
    // Window already ended.
    mockWindows = [{ hostId: null, startsAt: 0, endsAt: Date.now() - 60_000 }]

    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(summary.maintenanceSuppressed).toBe(0)
  })

  test('suppression does not commit dedup state: the condition stays "new" on the next sweep', async () => {
    mockWindows = [{ hostId: null, startsAt: 0, endsAt: Date.now() + 60_000 }]
    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    await runHealthSweep()
    // Nothing committed to the dedup store for the suppressed condition.
    expect(alertStateStore.get('0:test-sweep-rule')).toBeUndefined()

    // Window closes; the same condition should notify normally now, as if
    // suppression never happened (no stale cooldown/escalation state).
    mockWindows = []
    const summary = await runHealthSweep()
    expect(summary.alertsDispatched).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// runHealthSweep — ACK / manual resolution (plan 29)
// ---------------------------------------------------------------------------
describe('runHealthSweep — ACK suppression', () => {
  test('an active ACK suppresses dispatch and does NOT reset the reminder cooldown', async () => {
    activeAcks = [
      { hostId: 0, ruleId: TEST_RULE_ID, expiresAt: Date.now() + 60_000 },
    ]

    globalThis.fetch = mock(async () => {
      fetchCalls.push({ status: 200 })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(fetchCalls).toHaveLength(0)
    expect(summary.alertsDispatched).toBe(0)
    expect(summary.ackedSuppressed).toBe(1)

    // Critically: the acked (non-delivered) notification must not commit —
    // otherwise a short ACK would silently start the full reminder cooldown.
    const { alertStateKey } = await import('./alert-state-store')
    expect(alertStateStore.get(alertStateKey(0, TEST_RULE_ID))).toBeUndefined()

    // Once the ACK lifts, the very next sweep delivers normally as a fresh
    // "new" alert — proving no cooldown/dedup side effect was persisted.
    activeAcks = []
    const summary2 = await runHealthSweep()
    expect(fetchCalls).toHaveLength(1)
    expect(summary2.alertsDispatched).toBe(1)
    expect(fakeDb.rows[0]?.decision_kind).toBe('new')
  })

  test('a recovery is never suppressed by an ACK, and clears it', async () => {
    globalThis.fetch = mock(async () => {
      fetchCalls.push({ status: 200 })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    // First sweep: condition fires and delivers/commits normally.
    await runHealthSweep()
    expect(fetchCalls).toHaveLength(1)

    // Condition resolves; simulate an operator ACK still "active" at the
    // moment of recovery.
    testValue = 0
    activeAcks = [
      { hostId: 0, ruleId: TEST_RULE_ID, expiresAt: Date.now() + 60_000 },
    ]

    const summary = await runHealthSweep()

    // Recovery still dispatches (never suppressed) …
    expect(fetchCalls).toHaveLength(2)
    expect(summary.recoveries).toBe(1)
    expect(summary.ackedSuppressed).toBe(0)
    // … and the now-moot ACK is cleared.
    expect(clearAckCalls).toContainEqual({ hostId: 0, ruleId: TEST_RULE_ID })
  })
})

// ---------------------------------------------------------------------------
// runHealthSweep — outbound webhook-subscriptions bus (#2664)
// ---------------------------------------------------------------------------
//
// `203.0.113.10` (TEST-NET-3, RFC 5737) is used as the bus subscriber's URL:
// an IP literal skips DNS resolution entirely in `validateHostUrl` (see
// `host-url.ts`), so these tests exercise the REAL `emitInstanceEvent` →
// `deliver()` path (real HMAC signing, real SSRF guard) without any DNS call
// or injected test doubles — `dispatchDedupedAlertEvent` (called from
// `server-sweep.ts`) does not accept injectable deps, matching every other
// fire-and-forget producer in this codebase (see `outbound-bus.ts`'s module
// docblock / `user-connections.ts`'s `void emitEvent(...)`).
describe('runHealthSweep — outbound webhook-subscriptions bus (#2664)', () => {
  const BUS_URL = 'https://203.0.113.10/hook'
  const BUS_SECRET = 'bus-subscriber-secret'

  function seedInstanceSubscription(eventTypes: string[]) {
    fakeDb = makeFakeD1(
      [],
      [
        {
          id: 'bus-sub-1',
          user_id: 'some-other-user', // NOT the sweep's own owner id — proves this is instance-scoped, not user-scoped
          url: BUS_URL,
          secret: BUS_SECRET,
          event_types: JSON.stringify(eventTypes),
          enabled: 1,
          scope: 'instance',
          created_at: 1,
          updated_at: 1,
        },
      ]
    )
  }

  test('alert.fired reaches an instance-scoped subscription, HMAC-signed, alongside the legacy webhook', async () => {
    seedInstanceSubscription(['alert.fired', 'alert.resolved'])

    const posted: {
      url: string
      headers: Record<string, string>
      body: string
    }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init) => {
      posted.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ''),
      })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // Legacy channel unaffected — the bus is additive, not a replacement.
    const legacyPost = posted.find((p) =>
      p.url.startsWith('https://hooks.slack.com')
    )
    expect(legacyPost).toBeTruthy()
    expect(summary.alertsDispatched).toBe(1)

    // Give the fire-and-forget bus delivery a tick to land (it's never
    // awaited by runHealthSweep — see the describe block docblock).
    await new Promise((resolve) => setTimeout(resolve, 20))

    const busPost = posted.find((p) => p.url === BUS_URL)
    expect(busPost).toBeTruthy()
    expect(busPost?.headers['X-Chmonitor-Event']).toBe('alert.fired')

    const expectedSig = createHmac('sha256', BUS_SECRET)
      .update(busPost?.body ?? '')
      .digest('hex')
    expect(busPost?.headers['X-Chmonitor-Signature']).toBe(
      `sha256=${expectedSig}`
    )

    const payload = JSON.parse(busPost?.body ?? '{}')
    expect(payload).toMatchObject({
      type: 'alert.fired',
      host_id: 0,
      data: {
        ruleId: TEST_RULE_ID,
        title: 'Test Sweep Rule',
        severity: 'critical',
        hostId: 0,
        resolved: false,
      },
    })

    expect(fakeDb.deliveries).toHaveLength(1)
    expect(fakeDb.deliveries[0]).toMatchObject({
      status: 'delivered',
      event_type: 'alert.fired',
    })
  })

  test('alert.resolved fires with resolved:true and the pre-recovery severity', async () => {
    seedInstanceSubscription(['alert.fired', 'alert.resolved'])
    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof fetch

    // First sweep: fires (critical) and commits dedup state.
    await runHealthSweep()
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Second sweep: condition resolves.
    testValue = 0
    const posted: { url: string; body: string }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init) => {
      posted.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    await runHealthSweep()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const busPost = posted.find((p) => p.url === BUS_URL)
    expect(busPost).toBeTruthy()
    const payload = JSON.parse(busPost?.body ?? '{}')
    expect(payload.type).toBe('alert.resolved')
    expect(payload.data).toMatchObject({ resolved: true, severity: 'critical' })
  })

  test('fires regardless of legacy channel config — no webhook URL, no routes, still delivers to the bus and commits dedup', async () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = ''
    seedInstanceSubscription(['alert.fired'])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()
    await new Promise((resolve) => setTimeout(resolve, 20))

    // No legacy channel configured at all -> alertsDispatched (legacy-only
    // counter) stays 0, same as the "no route matches" test above …
    expect(summary.alertsDispatched).toBe(0)
    // … but the bus is its own channel and fired anyway.
    expect(posted).toContain(BUS_URL)
    expect(fakeDb.deliveries).toHaveLength(1)

    // Dedup committed too (not just the legacy path): a second sweep with
    // the SAME still-firing condition is a suppressed repeat, not a fresh
    // "new" — proving `evaluateAlert` ran and `commit()` was called even
    // with zero legacy destinations.
    const summary2 = await runHealthSweep()
    expect(summary2.alertsSuppressed).toBe(1)
  })

  test('a dead (non-retryable) bus subscriber never breaks the legacy webhook delivery', async () => {
    seedInstanceSubscription(['alert.fired'])

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      // The bus subscriber is broken (404 = non-retryable, dead-lettered
      // immediately); the legacy Slack webhook is healthy.
      if (String(url) === BUS_URL) {
        return new Response(null, { status: 404 })
      }
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Legacy delivery succeeded and was counted, completely unaffected by
    // the broken bus subscriber.
    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toContain('https://hooks.slack.com/services/T000/B000/XXXX')
    expect(fakeDb.deliveries).toHaveLength(1)
    expect(fakeDb.deliveries[0]?.status).toBe('dead')
  })

  test('no instance-scoped subscription exists -> the bus is a silent no-op, zero behavior change', async () => {
    // Default fakeDb from beforeEach has no instance-scoped subscriptions.
    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toEqual(['https://hooks.slack.com/services/T000/B000/XXXX'])
    expect(fakeDb.deliveries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// runHealthSweep — digest grouping / batching (#2663)
// ---------------------------------------------------------------------------
describe('runHealthSweep — digest grouping (#2663)', () => {
  const EXTRA_RULE_IDS = [
    'group-rule-1',
    'group-rule-2',
    'group-rule-3',
    'group-rule-4',
  ]

  function registerExtraFiringRules() {
    for (const id of EXTRA_RULE_IDS) {
      ruleRegistry.register({
        id,
        type: 'custom',
        title: `Group ${id}`,
        description: 'Extra synthetic firing rule for digest grouping tests.',
        sql: `SELECT 1 /* ${TEST_RULE_MARKER} */`,
        valueKey: 'test_value',
        defaults: { warning: 10, critical: 20 },
      })
    }
  }
  function unregisterExtraFiringRules() {
    for (const id of EXTRA_RULE_IDS) ruleRegistry.unregister(id)
  }

  test('5 findings for one Slack target produce ONE grouped message + one digest row', async () => {
    // TEST_RULE_ID + 4 extra rules all fire critical (value 50) on host 0, all
    // routed to the legacy Slack webhook → a single combined digest.
    registerExtraFiringRules()
    try {
      const posted: { url: string; body: Record<string, unknown> | null }[] = []
      globalThis.fetch = mock(async (url: string | URL | Request, init) => {
        posted.push({
          url: String(url),
          body: init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : null,
        })
        return new Response(null, { status: 200 })
      }) as unknown as typeof fetch

      const summary = await runHealthSweep()

      // Five findings, but ONE webhook POST (the digest) to the Slack target.
      expect(summary.totalFindings).toBe(5)
      expect(summary.alertsDispatched).toBe(5)
      expect(posted).toHaveLength(1)
      expect(posted[0].url).toBe(
        'https://hooks.slack.com/services/T000/B000/XXXX'
      )

      // Slack digest body: header summary line + one section listing findings.
      const attachments = posted[0].body?.attachments as
        | { blocks: { type: string; text?: { text: string } }[] }[]
        | undefined
      const header = attachments?.[0].blocks[0]
      expect(header?.text?.text).toContain('5 critical on 1 host')

      // ONE 'digest' history row referencing all five findings.
      expect(fakeDb.rows).toHaveLength(1)
      expect(fakeDb.rows[0].rule).toBe('digest')
      expect(fakeDb.rows[0].channel).toBe('slack')
      expect(fakeDb.rows[0].delivered).toBe(1)
      const refs = JSON.parse(fakeDb.rows[0].finding_refs ?? '[]') as string[]
      expect(refs).toHaveLength(5)
      expect(refs).toContain(`0:${TEST_RULE_ID}`)
    } finally {
      unregisterExtraFiringRules()
    }
  })

  test('a lone finding is unchanged — no digest wrapper, real rule id row', async () => {
    const posted: { url: string; body: Record<string, unknown> | null }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init) => {
      posted.push({
        url: String(url),
        body: init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : null,
      })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toHaveLength(1)
    // Single-send body is the plain `{ text, content }` wrapper — NOT a digest.
    expect(posted[0].body).not.toHaveProperty('attachments')
    expect(posted[0].body).toHaveProperty('text')
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.rows[0].rule).toBe(TEST_RULE_ID)
    expect(fakeDb.rows[0].decision_kind).toBe('new')
    expect(fakeDb.rows[0].finding_refs).toBeNull()
  })

  test('time-window mode: a critical BYPASSES the buffer (dispatched this pass)', async () => {
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '30'
    testValue = 50 // critical

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    expect(summary.digestBuffered).toBe(0)
    expect(summary.alertsDispatched).toBe(1)
    expect(posted).toHaveLength(1)
    expect(fakeDb.bufferRows).toHaveLength(0)
  })

  test('time-window mode: a non-critical is buffered, then flushed after the window', async () => {
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '30'
    testValue = 15 // warning (10 <= 15 < 20), global gate at 'warning'

    const realNow = Date.now
    let clock = realNow()
    globalThis.Date.now = () => clock

    try {
      const posted: string[] = []
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        posted.push(String(url))
        return new Response(null, { status: 200 })
      }) as unknown as typeof fetch

      // Sweep 1: the warning is buffered, not delivered.
      const first = await runHealthSweep()
      expect(first.digestBuffered).toBe(1)
      expect(first.alertsDispatched).toBe(0)
      expect(posted).toHaveLength(0)
      expect(fakeDb.bufferRows).toHaveLength(1)

      // Advance past the 30-minute window; sweep 2 flushes the due entry. The
      // still-firing live warning is deduped (already committed at buffer time)
      // so it is NOT re-buffered — only the due entry is delivered.
      clock += 31 * 60_000
      const second = await runHealthSweep()
      expect(second.digestFlushed).toBe(1)
      expect(posted).toHaveLength(1)
      expect(posted[0]).toBe('https://hooks.slack.com/services/T000/B000/XXXX')
      expect(fakeDb.bufferRows).toHaveLength(0)
    } finally {
      globalThis.Date.now = realNow
    }
  })

  test('fail-open: digest window on but no D1 → the finding dispatches this pass', async () => {
    fakeDb = null as unknown as ReturnType<typeof makeFakeD1>
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '30'
    testValue = 15 // warning

    const posted: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      posted.push(String(url))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runHealthSweep()

    // No D1 ⇒ buffer write fails ⇒ falls back to immediate in-pass grouping.
    expect(summary.digestBuffered).toBe(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toBe('https://hooks.slack.com/services/T000/B000/XXXX')
  })
})

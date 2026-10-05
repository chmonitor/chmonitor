/**
 * One read for the `get_metrics` health snapshot (issue #3643).
 *
 * `get_metrics` used to fire three independent ClickHouse reads — `version()`,
 * `uptime()`, and three rows from `system.metrics` — inside a `Promise.all`.
 * This file pins the replacement: ONE read for the whole snapshot, with a
 * result that is field-for-field the three-read answer.
 *
 * It drives the shipped `createHealthTools` through its real `execute` path
 * (`helpers.readOnlyQuery` → `fetchData`) with a querier that records each
 * call's delay and bytes, and compares that against an in-test replica of the
 * old three-read path fed by the SAME fake server — so the deep-equal compares
 * two pipelines over one source of truth, not two hand-written expectations.
 */

import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

// Dynamic import so shared-mocks' mock.module() registrations land first.
const { createHealthTools } = await import('../health-tools')
const { readOnlyQuery } = await import('../helpers')

/** Simulated fixed cost of one ClickHouse round trip, in ms. */
const UNIT_DELAY_MS = 20
/** Simulated per-byte cost (ms), so payload size is priced into the timing. */
const PER_BYTE_MS = 0.001

/** The old three reads, verbatim — the uncoordinated baseline. */
const BASELINE_VERSION_SQL = 'SELECT version() AS version'
const BASELINE_UPTIME_SQL = 'SELECT uptime() AS uptime_seconds'
const BASELINE_METRICS_SQL = `SELECT metric, value FROM system.metrics WHERE metric IN ('TCPConnection', 'HTTPConnection', 'MemoryTracking') ORDER BY metric`
/** How many reads one health snapshot used to cost. */
const BASELINE_READ_COUNT = 3

type MetricRow = { metric: string; value: unknown }

/** The parts of a ClickHouse server that `get_metrics` reads. */
type FakeServer = {
  version: string
  uptimeSeconds: number
  metricRows: MetricRow[]
}

type RecordedCall = {
  query: string
  bytes: number
  /** The delay the mock was asked to charge. */
  delayMs: number
  /** What that delay actually cost in wall-clock terms this run. */
  observedMs: number
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createFakeServer(metricRows: MetricRow[]): FakeServer {
  return { version: '24.8.4.13', uptimeSeconds: 864000, metricRows }
}

/**
 * Ceiling for the batched makespan: half the cost of the three reads it
 * replaced, where one read is what a read actually cost *in this run*
 * (`observedMs`), not what the mock was asked to charge. Sourcing the ceiling
 * from the same run keeps the bound honest under timer jitter — a loaded CI box
 * inflates the read and the ceiling together, so the ratio still has to hold,
 * and three reads re-issued one after another cost three units against a
 * 1.5-unit bar.
 *
 * Throws on an empty run rather than returning 0: a `makespan <= 0` ceiling
 * would let a tool that read *nothing at all* sail through.
 */
function makespanCeilingMs(calls: RecordedCall[]): number {
  const observedMs = calls[0]?.observedMs
  if (observedMs === undefined)
    throw new Error('no read was recorded, so there is nothing to time')

  return 0.5 * BASELINE_READ_COUNT * observedMs
}

/**
 * Route one query to the rows a real ClickHouse would answer with.
 *
 * A query that names all three sources is the single combined snapshot and
 * returns one row. Detection is by SOURCE, not by the tool's exact SQL, so any
 * one-query implementation satisfies it and a regression back to three
 * independent reads is caught.
 */
function routeQuery(query: string, server: FakeServer): unknown[] {
  const readsVersion = query.includes('version()')
  const readsUptime = query.includes('uptime()')
  const readsMetrics = query.includes('system.metrics')

  if (readsVersion && readsUptime && readsMetrics) {
    return [
      {
        version: server.version,
        uptime_seconds: server.uptimeSeconds,
        // Reversed on purpose: the tool owes the caller the metric ordering
        // that the old `ORDER BY metric` used to provide.
        metric_values: [...server.metricRows]
          .sort((a, b) => byName(b.metric, a.metric))
          .map((row) => [row.metric, row.value]),
      },
    ]
  }
  if (readsVersion) return [{ version: server.version }]
  if (readsUptime) return [{ uptime_seconds: server.uptimeSeconds }]
  if (readsMetrics)
    return [...server.metricRows].sort((a, b) => byName(a.metric, b.metric))
  return []
}

/**
 * Install the recording querier in place of `fetchData` and hand back the call
 * log. Each call sleeps for its own recorded delay, so a wall-clock measurement
 * of a tool call reflects the fan-out it caused.
 */
function installRecordingQuerier(server: FakeServer) {
  const calls: RecordedCall[] = []

  mockFetchData.mockImplementation(async (params: Record<string, unknown>) => {
    const query = String(params.query)
    const bytes = JSON.stringify(params).length
    const delayMs = UNIT_DELAY_MS + bytes * PER_BYTE_MS

    const startedAt = performance.now()
    await sleep(delayMs)

    calls.push({
      query,
      bytes,
      delayMs,
      observedMs: performance.now() - startedAt,
    })
    return { data: routeQuery(query, server), error: null }
  })

  return calls
}

/**
 * The `get_metrics` body as it was before #3643: three independent reads
 * folded into one object. Runs through the real `readOnlyQuery`, so the
 * baseline pays the same per-call overhead the tool does.
 */
async function runThreeReadBaseline() {
  const [versionResult, uptimeResult, metricsResult] = await Promise.all([
    readOnlyQuery({ query: BASELINE_VERSION_SQL, hostId: 0 }),
    readOnlyQuery({ query: BASELINE_UPTIME_SQL, hostId: 0 }),
    readOnlyQuery({ query: BASELINE_METRICS_SQL, hostId: 0 }),
  ])

  const versionRows = versionResult as Array<{ version: unknown }>
  const uptimeRows = uptimeResult as Array<{ uptime_seconds: unknown }>
  const metricsRows = metricsResult as Array<{
    metric: string
    value: unknown
  }>

  const metrics: Record<string, unknown> = {
    version: versionRows[0]?.version,
    uptime_seconds: uptimeRows[0]?.uptime_seconds,
  }

  for (const row of metricsRows) {
    metrics[String(row.metric)] = row.value
  }

  return metrics
}

function makeTools() {
  const tools = createHealthTools(0) as {
    get_metrics: { execute: (input: unknown) => Promise<unknown> }
  }
  return tools
}

const TYPICAL_ROWS: MetricRow[] = [
  { metric: 'TCPConnection', value: 42 },
  { metric: 'HTTPConnection', value: 10 },
  { metric: 'MemoryTracking', value: 8589934592 },
]

describe('get_metrics — one read for the health snapshot (#3643)', () => {
  test('collapses three reads into one and still returns the same snapshot', async () => {
    const server = createFakeServer(TYPICAL_ROWS)

    const baselineCalls = installRecordingQuerier(server)
    const baselineMetrics = await runThreeReadBaseline()

    expect(baselineCalls).toHaveLength(BASELINE_READ_COUNT)
    const baselineUnitDelaySum = baselineCalls.reduce(
      (total, call) => total + call.delayMs,
      0
    )
    const baselineBytes = baselineCalls.reduce(
      (total, call) => total + call.bytes,
      0
    )

    // Two runs: the win has to hold on a repeat call, not just the first one
    // (no warm-cache or one-off artifact carrying it).
    for (const run of [1, 2]) {
      const toolCalls = installRecordingQuerier(server)
      const tools = makeTools()

      const startedAt = performance.now()
      const metrics = (await tools.get_metrics.execute({})) as Record<
        string,
        unknown
      >
      const makespan = performance.now() - startedAt

      expect(
        toolCalls.length,
        `run ${run}: expected at most half of the ${BASELINE_READ_COUNT} baseline reads`
      ).toBeLessThanOrEqual(0.5 * BASELINE_READ_COUNT)
      expect(
        makespan,
        `run ${run}: makespan ${makespan.toFixed(1)}ms must stay under half of the ` +
          `${(0.5 * baselineUnitDelaySum).toFixed(1)}ms three-read unit-delay sum`
      ).toBeLessThanOrEqual(makespanCeilingMs(toolCalls))
      // The batched request is also a smaller payload than the three it
      // replaces — the per-call request overhead was paid three times.
      expect(
        toolCalls.reduce((total, call) => total + call.bytes, 0),
        `run ${run}: payload must not grow when the three reads are batched`
      ).toBeLessThan(baselineBytes)
      expect(
        metrics,
        `run ${run}: the snapshot must match the three-read result field-for-field`
      ).toStrictEqual(baselineMetrics)
      // Stronger than deep-equal on order: the old `ORDER BY metric` ordering
      // of the metric keys is part of what the model sees.
      expect(
        Object.keys(metrics),
        `run ${run}: key set and order must match the three-read result`
      ).toEqual(Object.keys(baselineMetrics))
    }
  })

  test('the single read still covers version, uptime and system.metrics', async () => {
    const calls = installRecordingQuerier(createFakeServer(TYPICAL_ROWS))
    const tools = makeTools()

    await tools.get_metrics.execute({})

    expect(calls).toHaveLength(1)
    const [only] = calls
    expect(only.query).toContain('version()')
    expect(only.query).toContain('uptime()')
    expect(only.query).toContain('system.metrics')
  })

  test('a metric system.metrics does not report stays absent', async () => {
    const server = createFakeServer([{ metric: 'MemoryTracking', value: 4096 }])

    installRecordingQuerier(server)
    const baselineMetrics = await runThreeReadBaseline()
    expect(Object.keys(baselineMetrics)).toEqual([
      'version',
      'uptime_seconds',
      'MemoryTracking',
    ])

    installRecordingQuerier(server)
    const tools = makeTools()
    const metrics = (await tools.get_metrics.execute({})) as Record<
      string,
      unknown
    >

    expect(metrics).toStrictEqual(baselineMetrics)
    expect('TCPConnection' in metrics).toBe(false)
    expect('HTTPConnection' in metrics).toBe(false)
  })

  test('an empty system.metrics leaves the version/uptime snapshot intact', async () => {
    const server = createFakeServer([])

    installRecordingQuerier(server)
    const baselineMetrics = await runThreeReadBaseline()

    installRecordingQuerier(server)
    const tools = makeTools()
    const metrics = (await tools.get_metrics.execute({})) as Record<
      string,
      unknown
    >

    expect(metrics).toStrictEqual(baselineMetrics)
    expect(Object.keys(metrics)).toEqual(['version', 'uptime_seconds'])
  })

  test('values keep the type they arrived with', async () => {
    // The wire types here are what a read-only query hands back. An aggregate
    // over the values (max/sum) would coerce them, so this is the guard that a
    // future rewrite does not start folding `system.metrics` rows numerically.
    const server = createFakeServer([
      { metric: 'TCPConnection', value: 42 },
      { metric: 'HTTPConnection', value: 10 },
      { metric: 'MemoryTracking', value: '8589934592' },
    ])

    installRecordingQuerier(server)
    const baselineMetrics = await runThreeReadBaseline()

    installRecordingQuerier(server)
    const tools = makeTools()
    const metrics = (await tools.get_metrics.execute({})) as Record<
      string,
      unknown
    >

    expect(typeof metrics.version).toBe('string')
    expect(typeof metrics.uptime_seconds).toBe('number')
    expect(typeof metrics.TCPConnection).toBe('number')
    expect(typeof metrics.MemoryTracking).toBe('string')
    expect(metrics.MemoryTracking).toBe('8589934592')
    expect(metrics).toStrictEqual(baselineMetrics)
  })
})

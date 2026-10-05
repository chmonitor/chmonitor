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

/** The `system.metrics` rows `get_metrics` asks for. */
const METRIC_NAMES = ['TCPConnection', 'HTTPConnection', 'MemoryTracking']

/** The old three reads, verbatim — the uncoordinated baseline. */
const BASELINE_VERSION_SQL = 'SELECT version() AS version'
const BASELINE_UPTIME_SQL = 'SELECT uptime() AS uptime_seconds'
const BASELINE_METRICS_SQL = `SELECT metric, value FROM system.metrics WHERE metric IN ('TCPConnection', 'HTTPConnection', 'MemoryTracking') ORDER BY metric`

type MetricRow = { metric: string; value: unknown }

/** The parts of a ClickHouse server that `get_metrics` reads. */
type FakeServer = {
  version: string
  uptimeSeconds: number
  metricRows: MetricRow[]
}

type RecordedCall = { query: string; bytes: number; delayMs: number }

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * How far past its own delay a timer actually lands in this process right now.
 *
 * The makespan bound below is about the change under test, not about how loaded
 * the machine running it is: a busy CI box can park a 20ms timer well past
 * 20ms, and without this the test would go red on load while the code is fine.
 * Measured in the same process, immediately before the assertion it corrects.
 */
async function schedulingDrift(delays: number[]): Promise<number> {
  const overruns = await Promise.all(
    delays.map((ms) => {
      const startedAt = performance.now()
      return sleep(ms).then(() => performance.now() - startedAt - ms)
    })
  )
  return Math.max(0, ...overruns)
}

function createFakeServer(metricRows: MetricRow[]): FakeServer {
  return { version: '24.8.4.13', uptimeSeconds: 864000, metricRows }
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
    calls.push({ query, bytes, delayMs })
    await sleep(delayMs)
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

    expect(baselineCalls).toHaveLength(3)
    const baselineUnitDelaySum = baselineCalls.reduce(
      (total, call) => total + call.delayMs,
      0
    )
    const baselineBytes = baselineCalls.reduce(
      (total, call) => total + call.bytes,
      0
    )
    const makespanBudget = 0.5 * baselineUnitDelaySum

    for (const run of [1, 2]) {
      const toolCalls = installRecordingQuerier(server)
      const tools = makeTools()

      const drift = await schedulingDrift([UNIT_DELAY_MS])
      const startedAt = performance.now()
      const metrics = (await tools.get_metrics.execute({})) as Record<
        string,
        unknown
      >
      const makespan = performance.now() - startedAt
      const criticalPath = toolCalls.reduce(
        (total, call) => total + call.delayMs,
        0
      )

      expect(
        toolCalls.length,
        `run ${run}: expected at most half of the ${baselineCalls.length} baseline reads`
      ).toBeLessThanOrEqual(0.5 * baselineCalls.length)
      // Wall clock, with the machine's own scheduling drift discounted.
      expect(
        makespan - drift,
        `run ${run}: makespan must stay under half of the ${baselineUnitDelaySum.toFixed(2)}ms baseline unit-delay sum`
      ).toBeLessThanOrEqual(makespanBudget)
      // The same bound on the delays the tool itself asked for, so a stalled
      // clock cannot pass this by accident.
      expect(
        criticalPath,
        `run ${run}: the critical path must stay under half of the baseline unit-delay sum`
      ).toBeLessThanOrEqual(makespanBudget)
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

  test('reads every metric name it reports', async () => {
    const server = createFakeServer(TYPICAL_ROWS)
    const calls = installRecordingQuerier(server)
    const tools = makeTools()

    await tools.get_metrics.execute({})

    const [only] = calls
    for (const name of METRIC_NAMES) {
      expect(only.query).toContain(name)
    }
  })
})

import { describe, expect, mock, test } from 'bun:test'

/**
 * `get_metrics` must answer one health snapshot from ONE read, with a payload
 * deep-equal to the old three-read path (pinned below, not derived from the
 * current code). The invocation count distinguishes "batched" from
 * "uncoordinated"; the makespan ceiling catches the three reads being re-issued
 * sequentially.
 */

type MetricsRow = { metric: string; value: number }

interface SnapshotFixture {
  version: string
  uptimeSeconds: number
  metrics: MetricsRow[]
}

/** The three reads `get_metrics` used to issue, verbatim. */
const BASELINE_VERSION_SQL = 'SELECT version() AS version'
const BASELINE_UPTIME_SQL = 'SELECT uptime() AS uptime_seconds'
const BASELINE_METRICS_SQL =
  'SELECT metric, value FROM system.metrics WHERE metric IN ' +
  "('TCPConnection', 'HTTPConnection', 'MemoryTracking') ORDER BY metric"

const BASELINE_READ_COUNT = 3

/** Sized well above `setTimeout` granularity so the makespan ceiling has headroom. */
const UNIT_DELAY_MS = 30

/**
 * `MemoryTracking` sits above 2^32 on a real node, so it proves a `value`
 * survives as a JS number instead of drifting into a string or a lossy int32.
 */
const FIXTURE: SnapshotFixture = {
  version: '26.5.1.882',
  uptimeSeconds: 123_456,
  metrics: [
    { metric: 'HTTPConnection', value: 3 },
    { metric: 'MemoryTracking', value: 5_793_280_120 },
    { metric: 'TCPConnection', value: 7 },
  ],
}

interface FetchArgs {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
  clickhouse_settings?: Record<string, unknown>
}

interface RecordedFetch {
  args: FetchArgs
  requestBytes: number
  responseBytes: number
  /** Wall time this invocation actually cost, measured — never assumed. */
  observedMs: number
}

type FetchOutcome =
  | { data: unknown; error: null }
  | { data: null; error: Error }
type FetchImpl = (args: FetchArgs) => Promise<FetchOutcome>

const encoder = new TextEncoder()

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Stand-in for ClickHouse. A query naming one thing gets the old narrow shape;
 * one naming several gets a single wide row, where ClickHouse serializes
 * `Array(Tuple(String, Int64))` as two-element arrays under JSONEachRow
 * (confirmed against 26.5).
 */
function respondTo(query: string, fixture: SnapshotFixture): unknown[] {
  const wants = {
    version: /version\(\)/.test(query),
    uptime: /uptime\(\)/.test(query),
    metrics: /system\.metrics/.test(query),
  }
  const named = Object.values(wants).filter(Boolean).length
  if (named === 0) return []

  if (wants.version && !wants.uptime && !wants.metrics) {
    return [{ version: fixture.version }]
  }
  if (wants.uptime && !wants.version && !wants.metrics) {
    return [{ uptime_seconds: fixture.uptimeSeconds }]
  }
  if (wants.metrics && !wants.version && !wants.uptime) {
    return fixture.metrics
  }

  return [
    {
      version: fixture.version,
      uptime_seconds: fixture.uptimeSeconds,
      metrics: fixture.metrics.map((row) => [row.metric, row.value]),
    },
  ]
}

function createRecordingFetch(
  fixture: SnapshotFixture,
  outcome?: (args: FetchArgs) => FetchOutcome
) {
  const calls: RecordedFetch[] = []

  const fetchImpl: FetchImpl = async (args) => {
    const requestBytes = encoder.encode(args.query).length
    const started = performance.now()
    await sleep(UNIT_DELAY_MS)
    // Measured, not the nominal constant: a loaded machine makes `setTimeout`
    // overshoot, and every ceiling below is derived from this so a correct
    // implementation can never fail because of timer jitter.
    const observedMs = performance.now() - started
    const resolved = outcome
      ? outcome(args)
      : { data: respondTo(args.query, fixture), error: null }
    calls.push({
      args,
      requestBytes,
      responseBytes: encoder.encode(JSON.stringify(resolved.data ?? null))
        .length,
      observedMs,
    })
    return resolved
  }

  return { calls, fetchImpl }
}

let activeFetch: FetchImpl = async () => ({ data: [], error: null })

const mockFetchData = mock((args: FetchArgs) => activeFetch(args))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerMetricsTool } from '../tools/metrics'
import { McpServer } from '@modelcontextprotocol/server'

function getToolHandler(server: McpServer, name: string) {
  const tools = (
    server as unknown as {
      _registeredTools: Record<string, { handler: Function }>
    }
  )._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

interface ToolRun {
  payload: Record<string, unknown>
  text: string
  structuredContent: Record<string, unknown> | undefined
  isError: boolean
  errorText: string | undefined
  calls: RecordedFetch[]
  makespanMs: number
}

async function runTool(
  fixture: SnapshotFixture = FIXTURE,
  outcome?: (args: FetchArgs) => FetchOutcome,
  args: Record<string, unknown> = {}
): Promise<ToolRun> {
  const { calls, fetchImpl } = createRecordingFetch(fixture, outcome)
  activeFetch = fetchImpl

  const server = new McpServer({ name: 'test', version: '0.0.1' })
  registerMetricsTool(server)
  const handler = getToolHandler(server, 'get_metrics')

  const started = performance.now()
  const result = (await handler(args)) as {
    content: Array<{ type: string; text: string }>
    structuredContent?: Record<string, unknown>
    isError?: boolean
  }
  const makespanMs = performance.now() - started

  const text = result.content[0].text
  return {
    payload: result.isError ? {} : JSON.parse(text),
    text,
    structuredContent: result.structuredContent,
    isError: result.isError === true,
    errorText: result.isError ? text : undefined,
    calls,
    makespanMs,
  }
}

/** The old three concurrent reads, combined as the old handler did. */
async function runUncoordinatedBaseline() {
  const { calls, fetchImpl } = createRecordingFetch(FIXTURE)

  const started = performance.now()
  const [versionResult, uptimeResult, metricsResult] = await Promise.all([
    fetchImpl({ query: BASELINE_VERSION_SQL }),
    fetchImpl({ query: BASELINE_UPTIME_SQL }),
    fetchImpl({ query: BASELINE_METRICS_SQL }),
  ])
  const makespanMs = performance.now() - started

  const versionRow = (
    Array.isArray(versionResult.data)
      ? versionResult.data[0]
      : versionResult.data
  ) as Record<string, unknown> | undefined
  const uptimeRow = (
    Array.isArray(uptimeResult.data) ? uptimeResult.data[0] : uptimeResult.data
  ) as Record<string, unknown> | undefined

  return {
    payload: {
      version: versionRow?.version,
      uptime_seconds: uptimeRow?.uptime_seconds,
      metrics: metricsResult.data,
    } as Record<string, unknown>,
    calls,
    makespanMs,
  }
}

const BASELINE = await runUncoordinatedBaseline()

/** Half of three reads: a batched call may use at most one. */
const INVOCATION_CEILING = 0.5 * BASELINE_READ_COUNT
/** Fraction of the three-read sequential cost the batch must stay under. */
const SEQUENTIAL_COST_FRACTION = 0.5

/**
 * Half the sum of three unit delays, with the unit measured in this run to
 * survive timer jitter. Throws on an empty run: a ceiling of 0 would let a tool
 * that read nothing pass.
 */
function makespanCeilingMs(calls: RecordedFetch[]): number {
  const unitMs = calls[0]?.observedMs
  if (unitMs === undefined) {
    throw new Error(
      'no fetchData invocation was recorded, so there is nothing to time'
    )
  }
  return SEQUENTIAL_COST_FRACTION * BASELINE_READ_COUNT * unitMs
}

describe('get_metrics batched into one read (#3644)', () => {
  test('baseline sanity: the pinned three-read path really does cost 3 reads', () => {
    expect(BASELINE.calls.length).toBe(BASELINE_READ_COUNT)
    expect(
      BASELINE.calls.every((call) => call.observedMs >= UNIT_DELAY_MS * 0.5),
      'the mock must actually charge a delay, or every ceiling below is vacuous'
    ).toBe(true)
  })

  // Two independent runs: the win has to hold on a repeat call, not just the
  // first one (no warm-cache or one-off artifact carrying it).
  for (const run of [1, 2] as const) {
    test(`run ${run}: one invocation, half the sequential makespan, identical payload`, async () => {
      const result = await runTool()

      expect(
        result.calls.length,
        `expected at most ${INVOCATION_CEILING} fetchData call(s), saw ${result.calls.length}`
      ).toBeLessThanOrEqual(INVOCATION_CEILING)
      // The ceiling is what the issue specifies, but on its own it also
      // passes if the tool read *nothing*. Pin the exact count so the claim is
      // falsifiable: 3 (the regression) and 0 (a degenerate no-op) both fail.
      expect(result.calls.length).toBe(1)

      const ceiling = makespanCeilingMs(result.calls)
      expect(
        result.makespanMs,
        `makespan ${result.makespanMs.toFixed(1)}ms exceeded half of the ` +
          `${(ceiling / SEQUENTIAL_COST_FRACTION).toFixed(1)}ms three-read cost`
      ).toBeLessThanOrEqual(ceiling)

      // The crux: one read must not change the answer the model receives.
      expect(result.payload).toEqual(BASELINE.payload)
      expect(result.structuredContent).toEqual(BASELINE.payload)
    })
  }

  test('the makespan ceiling is a real gate: three sequential reads blow it', async () => {
    // Proves the assertion above has teeth. A batched read lands near one
    // unit; re-issuing the three one after another costs three, which the
    // 1.5-unit ceiling must reject. Both numbers come from the same mock, so
    // this holds regardless of how loaded the machine is.
    const { calls, fetchImpl } = createRecordingFetch(FIXTURE)

    const started = performance.now()
    for (const query of [
      BASELINE_VERSION_SQL,
      BASELINE_UPTIME_SQL,
      BASELINE_METRICS_SQL,
    ]) {
      await fetchImpl({ query })
    }
    const sequentialMs = performance.now() - started

    expect(calls.length).toBe(BASELINE_READ_COUNT)
    expect(sequentialMs).toBeGreaterThan(makespanCeilingMs(calls))
  })

  test('the single read selects version, uptime and system.metrics together', async () => {
    const result = await runTool()

    expect(result.calls.length).toBe(1)
    const query = result.calls[0].args.query
    expect(query).toContain('version()')
    expect(query).toContain('uptime()')
    expect(query).toContain('system.metrics')
  })

  test('still forces readonly=1 and defaults hostId — one read, no new surface', async () => {
    const result = await runTool()

    expect(result.calls.length).toBe(1)
    // `runReadonlyFetch` owns the readonly setting; assert the batched tool
    // still routes through it instead of reaching for the raw client.
    expect(result.calls[0].args.clickhouse_settings).toEqual({ readonly: '1' })
    expect(result.calls[0].args.hostId).toBe(0)
  })

  test('forwards an explicit hostId unchanged', async () => {
    const result = await runTool(FIXTURE, undefined, { hostId: 2 })

    expect(result.calls.length).toBe(1)
    expect(result.calls[0].args.hostId).toBe(2)
    expect(result.payload).toEqual(BASELINE.payload)
  })
})

describe('get_metrics payload fidelity', () => {
  test('every field the three-read path produced survives, key order and type intact', async () => {
    const result = await runTool()
    const payload = result.payload

    // Key order is part of the text the model reads first.
    expect(Object.keys(payload)).toEqual([
      'version',
      'uptime_seconds',
      'metrics',
    ])

    // version() is a String and must never arrive as a Number.
    expect(payload.version).toBe(FIXTURE.version)
    expect(typeof payload.version).toBe('string')

    // uptime() is an integer and must never arrive as a String.
    expect(payload.uptime_seconds).toBe(FIXTURE.uptimeSeconds)
    expect(typeof payload.uptime_seconds).toBe('number')
    expect(Number.isInteger(payload.uptime_seconds)).toBe(true)

    // metrics is still one {metric, value} object per system.metrics row,
    // ordered by metric exactly as `ORDER BY metric` produced.
    const metrics = payload.metrics as MetricsRow[]
    expect(Array.isArray(metrics)).toBe(true)
    expect(metrics).toEqual(FIXTURE.metrics)
    expect(metrics.map((row) => row.metric)).toEqual([
      'HTTPConnection',
      'MemoryTracking',
      'TCPConnection',
    ])
    for (const row of metrics) {
      expect(Object.keys(row)).toEqual(['metric', 'value'])
      expect(typeof row.metric).toBe('string')
      expect(typeof row.value).toBe('number')
      expect(Number.isSafeInteger(row.value)).toBe(true)
    }

    // The serialized text — the only representation every MCP client reads —
    // carries the same three fields.
    expect(JSON.parse(result.text)).toEqual({
      version: FIXTURE.version,
      uptime_seconds: FIXTURE.uptimeSeconds,
      metrics: FIXTURE.metrics,
    })
  })

  test('a cluster missing all three metric names still gets version and uptime', async () => {
    // `groupArray` over an empty match yields `[]` rather than dropping the
    // row, so the scalars survive. This is the degradation that matters on a
    // real cluster: TCPConnection / HTTPConnection are config-dependent.
    const result = await runTool({ ...FIXTURE, metrics: [] })

    expect(result.isError).toBe(false)
    expect(result.calls.length).toBe(1)
    expect(result.payload).toEqual({
      version: FIXTURE.version,
      uptime_seconds: FIXTURE.uptimeSeconds,
      metrics: [],
    })
  })

  test('a partially-present metric set is returned as-is, not padded', async () => {
    const result = await runTool({
      ...FIXTURE,
      metrics: [{ metric: 'MemoryTracking', value: 42 }],
    })

    expect(result.payload).toEqual({
      version: FIXTURE.version,
      uptime_seconds: FIXTURE.uptimeSeconds,
      metrics: [{ metric: 'MemoryTracking', value: 42 }],
    })
  })

  test('an absent version() field stays absent rather than becoming null', async () => {
    // Pre-#3644 the handler read `versionRow?.version`, so an empty result
    // yielded `undefined`, which JSON.stringify drops from the text while
    // structuredContent keeps the key with an undefined value. Batching must
    // not turn that into `null` — the model would read null as "known absent".
    const result = await runTool(FIXTURE, () => ({
      data: [{ uptime_seconds: 123_456, metrics: [] }],
      error: null,
    }))

    expect(result.isError).toBe(false)
    expect(Object.keys(result.payload)).toEqual(['uptime_seconds', 'metrics'])
    expect(result.text).not.toContain('version')
    expect(result.structuredContent?.version).toBeUndefined()
    expect(result.structuredContent?.uptime_seconds).toBe(123_456)
  })

  test('a missing system.metrics returns the error envelope, not a partial payload', async () => {
    // system.metrics is a built-in table (always present, never config-gated),
    // and the pre-batching tool hard-failed on it too — so this is unchanged
    // behaviour, now pinned.
    const result = await runTool(FIXTURE, () => ({
      data: null,
      error: new Error("Table system.metrics doesn't exist"),
    }))

    expect(result.isError).toBe(true)
    expect(result.errorText).toContain("Table system.metrics doesn't exist")
    expect(result.payload).toEqual({})
  })

  test('a failing read costs one invocation, not three', async () => {
    const result = await runTool(FIXTURE, () => ({
      data: null,
      error: new Error('Connection refused'),
    }))

    expect(result.calls.length).toBe(1)
    expect(result.isError).toBe(true)
    expect(result.errorText).toContain('Connection refused')
  })
})

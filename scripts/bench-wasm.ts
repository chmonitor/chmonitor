import { performance } from 'node:perf_hooks'
import { transformClickHouseData } from '@/lib/api/transform-data'
import {
  transformClickHouseJsonEachRowWasm,
  transformClickHouseJsonEachRowWasmJson,
} from '@/lib/wasm/monitor-core'

const PROMOTION_THRESHOLD = 1.2

type BenchResult = {
  name: string
  size: string
  tsMs: number
  candidateMs: number
  speedup: number
}

function timeSync(iterations: number, fn: () => void): number {
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    fn()
  }
  return performance.now() - start
}

async function timeAsync(iterations: number, fn: () => Promise<void>) {
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    await fn()
  }
  return performance.now() - start
}

function makeClickHouseRows(size: number) {
  return Array.from({ length: size }, (_, index) => ({
    event_time: `2026-01-01 ${String(index % 24).padStart(2, '0')}:00:00`,
    query_count: String(index * 13),
    memory_usage: String(1024 * 1024 * (index + 1)),
    max_uint64: '18446744073709551615',
    nested: {
      read_rows: String(index * 100),
      ratio: String((index % 100) / 10),
    },
    values: [String(index), String(index + 1), 'text'],
  }))
}

function makeClickHouseJsonEachRow(size: number) {
  return makeClickHouseRows(size)
    .map((row) => JSON.stringify(row))
    .join('\n')
}

function parseAndTransformClickHouseJsonEachRow(input: string) {
  return transformClickHouseData(
    input
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
  )
}

async function benchClickHouseJsonEachRowTransform(
  sizeLabel: string,
  size: number,
  iterations: number
): Promise<BenchResult> {
  const data = makeClickHouseJsonEachRow(size)
  const tsMs = timeSync(iterations, () => {
    parseAndTransformClickHouseJsonEachRow(data)
  })
  const wasmMs = await timeAsync(iterations, async () => {
    await transformClickHouseJsonEachRowWasm(data)
  })

  return result('clickhouse-jsoneachrow-to-objects', sizeLabel, tsMs, wasmMs)
}

async function benchClickHouseJsonEachRowCliTransform(
  sizeLabel: string,
  size: number,
  iterations: number
): Promise<BenchResult> {
  const data = makeClickHouseJsonEachRow(size)
  const tsMs = timeSync(iterations, () => {
    JSON.stringify(parseAndTransformClickHouseJsonEachRow(data))
  })
  const wasmMs = await timeAsync(iterations, async () => {
    await transformClickHouseJsonEachRowWasmJson(data)
  })

  return result('clickhouse-jsoneachrow-to-json', sizeLabel, tsMs, wasmMs)
}

async function benchChartApiResponseEnvelope(
  sizeLabel: string,
  size: number,
  iterations: number
): Promise<BenchResult> {
  const data = makeClickHouseJsonEachRow(size)
  const metadata = {
    queryId: 'bench-query',
    duration: 0.01,
    rows: size,
    host: 'bench',
    status: 'ok',
  }
  const metadataJson = JSON.stringify(metadata)
  const tsMs = timeSync(iterations, () => {
    JSON.stringify({
      success: true,
      data: parseAndTransformClickHouseJsonEachRow(data),
      metadata,
    })
  })
  const wasmMs = await timeAsync(iterations, async () => {
    const normalizedJson = await transformClickHouseJsonEachRowWasmJson(data)
    const body = `{"success":true,"data":${normalizedJson},"metadata":${metadataJson}}`
    void body
  })

  return result('chart-api-response-envelope', sizeLabel, tsMs, wasmMs)
}

function result(
  name: string,
  size: string,
  tsMs: number,
  candidateMs: number
): BenchResult {
  return {
    name,
    size,
    tsMs,
    candidateMs,
    speedup: tsMs / candidateMs,
  }
}

await transformClickHouseJsonEachRowWasm(makeClickHouseJsonEachRow(1))
await transformClickHouseJsonEachRowWasmJson(makeClickHouseJsonEachRow(1))

const results = [
  await benchClickHouseJsonEachRowTransform('small', 100, 100),
  await benchClickHouseJsonEachRowTransform('medium', 2_500, 25),
  await benchClickHouseJsonEachRowTransform('large', 25_000, 5),
  await benchClickHouseJsonEachRowCliTransform('small', 100, 100),
  await benchClickHouseJsonEachRowCliTransform('medium', 2_500, 25),
  await benchClickHouseJsonEachRowCliTransform('large', 25_000, 5),
  await benchChartApiResponseEnvelope('small', 100, 100),
  await benchChartApiResponseEnvelope('medium', 2_500, 25),
  await benchChartApiResponseEnvelope('large', 25_000, 5),
]

console.table(
  results.map((item) => ({
    name: item.name,
    size: item.size,
    'ts ms': item.tsMs.toFixed(2),
    'candidate ms': item.candidateMs.toFixed(2),
    speedup: `${item.speedup.toFixed(2)}x`,
    promote: item.speedup >= PROMOTION_THRESHOLD ? 'yes' : 'no',
  }))
)

const promotable = results.filter((item) => item.speedup >= PROMOTION_THRESHOLD)
if (promotable.length === 0) {
  console.log(
    `No WASM candidate cleared the ${PROMOTION_THRESHOLD.toFixed(
      1
    )}x promotion threshold. Runtime TypeScript paths remain unchanged.`
  )
} else {
  console.log(
    `Promotable candidate(s): ${promotable
      .map((item) => `${item.name}/${item.size} ${item.speedup.toFixed(2)}x`)
      .join(', ')}`
  )
}

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const SIZES = [50_000, 200_000, 500_000]
const ITERATIONS = 8

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUST_DIR = resolve(__dirname, '../../rust')
const USER_EVENTS_BIN = resolve(RUST_DIR, 'target/release/user-events-rs')
const userEventsModule = await import(
  pathToFileURL(
    resolve(
      __dirname,
      '../../apps/dashboard/src/lib/chart-data-transforms/transforms/user-events.ts'
    )
  ).href
)
const { transformUserEventCounts } = userEventsModule

function generateData(size = 200000, users = 120, times = 1440) {
  const rows = []
  for (let i = 0; i < size; i++) {
    const minute = String(i % times).padStart(4, '0')
    rows.push({
      event_time: `2026-01-01T${String(Math.floor((i % 1440) / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z-${minute}`,
      user: `user_${i % users}`,
      count: (i % 100) + 1,
    })
  }
  return rows
}

function benchTs(data, iterations = ITERATIONS) {
  transformUserEventCounts(data) // warmup
  const times = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    transformUserEventCounts(data)
    times.push(performance.now() - start)
  }
  return times
}

function benchRustBinary(data, iterations = ITERATIONS) {
  const payload = JSON.stringify({ data, timeField: 'event_time' })
  const times = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    const proc = spawnSync(USER_EVENTS_BIN, [], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    })
    if (proc.status !== 0) {
      throw new Error(proc.stderr || 'Rust benchmark failed')
    }
    times.push(performance.now() - start)
  }
  return times
}

function summarize(name, times) {
  const sorted = [...times].sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  return { name, avg, p50, p95, min: sorted[0], max: sorted[sorted.length - 1] }
}

// Build once
console.log('Building Rust binary...')
spawnSync('cargo', ['build', '--release', '--quiet', '-p', 'user-events-rs'], {
  cwd: RUST_DIR,
  stdio: 'inherit',
})

console.log(`\nIterations per test: ${ITERATIONS}`)
console.log('─'.repeat(90))
console.log(`${'Rows'.padEnd(10)} ${'TypeScript (ms)'.padEnd(22)} ${'Rust binary (ms)'.padEnd(22)} ${'Speedup'.padEnd(10)}`)
console.log('─'.repeat(90))

const results = []

for (const size of SIZES) {
  const data = generateData(size)
  const tsSummary = summarize('TypeScript', benchTs(data))
  const rustSummary = summarize('Rust binary', benchRustBinary(data))
  const speedup = tsSummary.avg / rustSummary.avg

  console.log(
    `${String(size).padEnd(10)} ` +
    `avg=${tsSummary.avg.toFixed(1)} p50=${tsSummary.p50.toFixed(1)}`.padEnd(22) + ' ' +
    `avg=${rustSummary.avg.toFixed(1)} p50=${rustSummary.p50.toFixed(1)}`.padEnd(22) + ' ' +
    `${speedup.toFixed(2)}x`
  )

  results.push({ size, ts: tsSummary, rust: rustSummary, speedup })
}

console.log('─'.repeat(90))

const avgSpeedup = results.reduce((a, r) => a + r.speedup, 0) / results.length
console.log(`\nAverage speedup across all sizes: ${avgSpeedup.toFixed(2)}x`)

const largest = results[results.length - 1]
console.log(`\nDetailed (${largest.size.toLocaleString()} rows):`)
for (const s of [largest.ts, largest.rust]) {
  console.log(`  ${s.name}: avg=${s.avg.toFixed(2)}ms p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms min=${s.min.toFixed(2)}ms max=${s.max.toFixed(2)}ms`)
}

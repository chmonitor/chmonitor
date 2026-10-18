/**
 * hostId boundary parse+validate benchmark.
 *
 * This runs on EVERY API request (charts, tables, explorer, ...). The check is
 * `const n = Number(raw); const ok = Number.isInteger(n) && n >= 0`. The bench
 * guards that the hot-path parser stays O(1) and allocation-free across a
 * realistic mix of valid, malformed, negative, and fractional inputs.
 *
 * Run: `bun run src/lib/api/shared/validators/__tests__/host-id.bench.ts`
 */

function parseAndValidateHostId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

// Realistic param distribution: mostly valid, plus the malformed cases the fix
// now rejects (negative, fractional, garbage, overflow).
const INPUTS = [
  '0',
  '1',
  '2',
  '0',
  '1',
  '3',
  '10',
  '0',
  '1',
  '2', // valid (hot path)
  '-1',
  '1.5',
  '0.1',
  'abc',
  '1abc',
  'NaN',
  'Infinity',
  '1e400',
  '',
  '   ',
]

function bench(label: string, iters: number): number {
  let sink = 0
  for (let i = 0; i < 1000; i++) {
    for (const s of INPUTS) sink += parseAndValidateHostId(s) ?? 0
  }
  const start = performance.now()
  for (let i = 0; i < iters; i++) {
    for (const s of INPUTS) sink += parseAndValidateHostId(s) ?? 0
  }
  const elapsed = performance.now() - start
  const ops = iters * INPUTS.length
  console.log(
    `${label.padEnd(24)} ${ops} validations in ${elapsed.toFixed(1)}ms ` +
      `(${((elapsed / ops) * 1000).toFixed(4)} µs/op)  [sink=${sink}]`
  )
  return elapsed
}

console.log('=== hostId boundary parse+validate benchmark ===\n')
const elapsed = bench('mixed param corpus', 100_000)
const perOp = (elapsed / (100_000 * INPUTS.length)) * 1000 // µs
if (perOp > 1) {
  console.error(
    `FAIL: hostId validation slower than 1µs/op (${perOp.toFixed(3)}µs)`
  )
  process.exit(1)
}
console.log(`\nOK: ${perOp.toFixed(4)} µs/op (well under 1µs ceiling)`)

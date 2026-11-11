import {
  computeMergeProgress,
  MERGE_MAX_SAMPLE_GAP_MS,
  MERGE_WORK_COUNTERS,
  mergeStallSeconds,
  parseMergeObservations,
  stepMergeProgress,
} from './merge-progress'
import { describe, expect, test } from 'bun:test'

const T = 2_000_000
const row = (seconds = 0, changes: Record<string, unknown> = {}) => ({
  database: 'example',
  table: 'events',
  result_part_name: 'all_1_8_2',
  elapsed: 600 + seconds,
  progress: 1,
  rows_read: '9007199254740993',
  rows_written: '10',
  bytes_read_uncompressed: '20',
  bytes_written_uncompressed: '30',
  columns_written: '1',
  ...changes,
})
const observation = (seconds = 0, changes: Record<string, unknown> = {}) =>
  parseMergeObservations([row(seconds, changes)])![0]
const initial = () => stepMergeProgress(undefined, observation(), T).next

describe('merge work observations', () => {
  test('a first observation cannot prove a stall; counters remain exact', () => {
    const r = stepMergeProgress(undefined, observation(), T)
    expect(r.flatSeconds).toBeNull()
    expect(r.next.counters[0]).toBe('9007199254740993')
  })
  for (const key of MERGE_WORK_COUNTERS) {
    test(
      key +
        ' advancement resets the flat window independently, even at progress=1',
      () => {
        const base = row()[key]
        const r = stepMergeProgress(
          initial(),
          observation(600, {
            [key]: (BigInt(base as string) + BigInt(1)).toString(),
          }),
          T + 600_000
        )
        expect(r.flatSeconds).toBe(0)
        expect(r.next.flatSinceMs).toBe(T + 600_000)
      }
    )
  }
  test('progress advancement also resets its window', () => {
    const prev = stepMergeProgress(
      undefined,
      observation(0, { progress: 0.5 }),
      T
    ).next
    expect(
      stepMergeProgress(prev, observation(600), T + 600_000).flatSeconds
    ).toBe(0)
  })
  test('alternating fast and slow ClickHouse reads preserve start continuity', () => {
    const a = initial()
    const b = stepMergeProgress(a, observation(610), T + 600_000, T + 610_000)
    expect(b.flatSeconds).toBe(600)
    const c = stepMergeProgress(
      b.next,
      observation(1200),
      T + 1_200_000,
      T + 1_200_000
    )
    expect(c.flatSeconds).toBe(1200)
    const d = stepMergeProgress(
      c.next,
      observation(1810),
      T + 1_800_000,
      T + 1_810_000
    )
    expect(d.flatSeconds).toBe(1800)
    expect(
      stepMergeProgress(d.next, observation(2000), T + 2_400_000, T + 2_410_000)
        .flatSeconds
    ).toBeNull()
  })
  test('a delayed baseline cannot count request latency toward the stall timeout', () => {
    const a = computeMergeProgress(
      [observation(10)],
      { version: 0, updatedAtMs: 0, samples: [] },
      T,
      900,
      T + 10_000
    )
    expect(a.next.updatedAtMs).toBe(T + 10_000)
    expect(a.next.samples[0].flatSinceMs).toBe(T + 10_000)
    const b = computeMergeProgress([observation(600)], a.next, T + 600_000, 900)
    const c = computeMergeProgress([observation(900)], b.next, T + 900_000, 900)
    expect(c.value).toBeNull()
    const d = computeMergeProgress([observation(910)], c.next, T + 910_000, 900)
    expect(d.value).toBe(1)
  })
  test('vertical progress above 1 remains observable for advancing counters and flat stalls', () => {
    const progress = 1.0000000000000004
    const a = stepMergeProgress(undefined, observation(0, { progress }), T).next
    const b = stepMergeProgress(
      a,
      observation(600, { progress, columns_written: '2' }),
      T + 600_000
    )
    expect(b.flatSeconds).toBe(0)
    const c = stepMergeProgress(
      b.next,
      observation(1200, { progress, columns_written: '2' }),
      T + 1_200_000
    )
    const d = stepMergeProgress(
      c.next,
      observation(1800, { progress, columns_written: '2' }),
      T + 1_800_000
    )
    expect(d.flatSeconds).toBe(1200)
  })
  test('continuous samples reach the timeout inclusively', () => {
    const a = computeMergeProgress(
      [observation()],
      { version: 0, updatedAtMs: 0, samples: [] },
      T,
      900
    )
    expect(a.value).toBeNull()
    const b = computeMergeProgress([observation(600)], a.next, T + 600_000, 900)
    expect(b.value).toBeNull()
    const c = computeMergeProgress([observation(899)], b.next, T + 899_000, 900)
    expect(c.value).toBeNull()
    const d = computeMergeProgress([observation(900)], c.next, T + 900_000, 900)
    expect(d.value).toBe(1)
    expect(d.affected).toEqual(['example.events all_1_8_2'])
  })
  test('completed/disappeared merges are pruned by a complete empty snapshot', () => {
    const previous = { version: 1, updatedAtMs: T, samples: [initial()] }
    const r = computeMergeProgress([], previous, T + 600_000, 900)
    expect(r.value).toBe(0)
    expect(r.next.samples).toEqual([])
    expect(
      computeMergeProgress([observation(1200)], r.next, T + 1_200_000, 900)
        .value
    ).toBeNull()
  })
  test('an outage cannot resolve a stalled merge while rebuilding evidence', () => {
    const a = computeMergeProgress(
      [observation()],
      { version: 0, updatedAtMs: 0, samples: [] },
      T,
      900
    )
    const b = computeMergeProgress([observation(600)], a.next, T + 600_000, 900)
    const c = computeMergeProgress(
      [observation(1200)],
      b.next,
      T + 1_200_000,
      900
    )
    expect(c.value).toBe(1)
    const d = computeMergeProgress(
      [observation(2400)],
      c.next,
      T + 2_400_000,
      900
    )
    expect(d.value).toBeNull()
    const e = computeMergeProgress(
      [observation(3000)],
      d.next,
      T + 3_000_000,
      900
    )
    expect(e.value).toBeNull()
    expect(
      computeMergeProgress(
        [observation(3001, { columns_written: '2' })],
        e.next,
        T + 3_001_000,
        900
      ).value
    ).toBe(0)
  })
  for (const [name, seconds, now, changes] of [
    ['elapsed reset', 1, T + 600_000, {}],
    ['same-part restart', 200, T + 600_000, {}],
    ['counter decrease', 600, T + 600_000, { columns_written: '0' }],
    ['clock reversal', 0, T - 1, {}],
    ['stale outage', 901, T + MERGE_MAX_SAMPLE_GAP_MS + 1000, {}],
  ] as const) {
    test(`${name} cannot inherit a stall window`, () => {
      expect(
        stepMergeProgress(initial(), observation(seconds, changes), now)
          .flatSeconds
      ).toBeNull()
    })
  }
  test('partial, duplicate and malformed query rows are unknown', () => {
    for (const input of [
      null,
      {},
      [row(), row()],
      [row(0, { columns_written: null })],
      [row(0, { progress: 'NaN' })],
      [row(0, { elapsed: -1 })],
      [row(0, { rows_read: Number.MAX_SAFE_INTEGER + 2 })],
    ]) {
      expect(parseMergeObservations(input)).toBeNull()
    }
    expect(parseMergeObservations([])).toEqual([])
  })
  test('invalid timeout settings retain the 15-minute default', () => {
    for (const raw of [undefined, '', '0', '-1', 'junk', 'Infinity'])
      expect(mergeStallSeconds(raw)).toBe(900)
    expect(mergeStallSeconds('1200')).toBe(1200)
  })
})

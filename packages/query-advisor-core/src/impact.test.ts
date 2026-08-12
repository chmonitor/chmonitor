// The pure half of apps/dashboard's `__tests__/impact-estimator.test.ts`,
// moved here with the estimate math — issue #2936. The I/O half
// (`measurePrewhereImpact`, which issues the two EXPLAIN ESTIMATE calls) stays
// in the dashboard/MCP fetchers that own the ClickHouse connection.
import { describe, expect, test } from 'bun:test'

import {
  estimateBytesSaved,
  formatBytes,
  prewhereFallbackImpact,
  sumEstimateMarks,
  summarizeImpact,
  summarizePrewhereMarks,
} from './impact'

describe('estimateBytesSaved', () => {
  test('is proportional to the granules-saved fraction of the table', () => {
    expect(estimateBytesSaved(50, 100, 1000)).toBe(500)
  })

  test('returns 0 when granulesTotal is 0 (never divides by zero)', () => {
    expect(estimateBytesSaved(50, 0, 1000)).toBe(0)
  })

  test('returns 0 for non-positive granulesSaved', () => {
    expect(estimateBytesSaved(0, 100, 1000)).toBe(0)
    expect(estimateBytesSaved(-5, 100, 1000)).toBe(0)
  })

  test('clamps the fraction at 1 even if granulesSaved exceeds granulesTotal', () => {
    expect(estimateBytesSaved(150, 100, 1000)).toBe(1000)
  })
})

describe('formatBytes', () => {
  // Pins parity with the dashboard's `formatBytes` (src/lib/utils.ts): both
  // advisor surfaces must phrase the same estimate the same way.
  test('matches the dashboard formatter for the common magnitudes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512.0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })

  test('renders a dash for negative or non-finite input', () => {
    expect(formatBytes(-1)).toBe('-')
    expect(formatBytes(Number.NaN)).toBe('-')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('-')
  })
})

describe('summarizeImpact', () => {
  test('labels the summary as an estimate and reports a non-zero saved figure', () => {
    const impact = summarizeImpact({
      granulesRead: 900,
      granulesTotal: 1000,
      granulesSaved: 900,
      tableBytes: 10_000,
      unknown: false,
      label: 'a skip index',
    })
    expect(impact.unknown).toBe(false)
    expect(impact.granulesSaved).toBe(900)
    expect(impact.summary).toContain('ESTIMATE')
    expect(impact.summary).toContain('a skip index')
  })

  test('never fabricates a number when unknown — 0 impact, honest message', () => {
    const impact = summarizeImpact({
      granulesRead: 0,
      granulesTotal: 0,
      granulesSaved: 0,
      tableBytes: 0,
      unknown: true,
      label: 'a projection',
    })
    expect(impact.granulesSaved).toBe(0)
    expect(impact.bytesSaved).toBe(0)
    expect(impact.summary).toContain('could not be estimated')
    expect(impact.summary).not.toContain('ESTIMATE:')
  })
})

describe('sumEstimateMarks', () => {
  test('sums numeric and string marks, treating missing values as 0', () => {
    expect(sumEstimateMarks([{ marks: 10 }, { marks: '32' }, {}])).toBe(42)
  })
})

describe('summarizePrewhereMarks', () => {
  test('validates the rewrite when marks are unchanged', () => {
    const impact = summarizePrewhereMarks({
      beforeMarks: 42,
      afterMarks: 42,
      movedColumn: 'status',
    })
    expect(impact.summary).toContain('validated')
    expect(impact.summary).not.toContain('regress')
    expect(impact.granulesRead).toBe(42)
  })

  test('flags a regression when the rewrite reads MORE granules than before', () => {
    const impact = summarizePrewhereMarks({
      beforeMarks: 10,
      afterMarks: 50,
      movedColumn: 'status',
    })
    expect(impact.summary).toContain('do not apply this rewrite')
  })
})

describe('prewhereFallbackImpact', () => {
  test('degrades to a labeled estimate naming the moved column', () => {
    const impact = prewhereFallbackImpact({
      fallbackGranulesRead: 100,
      fallbackGranulesTotal: 200,
      tableBytes: 1000,
      movedColumn: 'status',
    })
    expect(impact.unknown).toBe(false)
    expect(impact.summary).toContain('PREWHERE')
    expect(impact.summary).toContain('status')
  })

  test('is honestly unknown when there are no granule totals to scale from', () => {
    const impact = prewhereFallbackImpact({
      fallbackGranulesRead: 0,
      fallbackGranulesTotal: 0,
      tableBytes: 0,
      movedColumn: 'status',
    })
    expect(impact.unknown).toBe(true)
    expect(impact.granulesSaved).toBe(0)
  })
})

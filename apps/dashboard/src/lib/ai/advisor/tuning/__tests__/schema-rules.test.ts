// @ts-nocheck — test file, only runs under bun:test

import type { ColumnProfile } from '../types'

import {
  compressionRatio,
  narrowerInt,
  ruleCompressionCodec,
  ruleLowCardinality,
  ruleNullableColumns,
  ruleOversizedIntegers,
  runSchemaRules,
} from '../schema-rules'
import { describe, expect, test } from 'bun:test'

function makeColumn(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    database: 'db',
    table: 'events',
    name: 'col',
    type: 'String',
    compressionCodec: '',
    compressedBytes: 10_000_000,
    uncompressedBytes: 40_000_000,
    rows: 1_000_000,
    ...overrides,
  }
}

describe('compressionRatio / narrowerInt helpers', () => {
  test('compressionRatio divides uncompressed by compressed', () => {
    expect(
      compressionRatio(
        makeColumn({ compressedBytes: 100, uncompressedBytes: 400 })
      )
    ).toBe(4)
  })
  test('compressionRatio is 0 when compressed is 0', () => {
    expect(compressionRatio(makeColumn({ compressedBytes: 0 }))).toBe(0)
  })
  test('narrowerInt steps down one width of same signedness', () => {
    expect(narrowerInt('Int64')).toBe('Int32')
    expect(narrowerInt('UInt64')).toBe('UInt32')
    expect(narrowerInt('UInt16')).toBe('UInt8')
    expect(narrowerInt('Int8')).toBe(null)
    expect(narrowerInt('String')).toBe(null)
  })
})

describe('ruleNullableColumns', () => {
  test('flags a Nullable column and unwraps the inner type in the DDL + verify query', () => {
    const findings = ruleNullableColumns([
      makeColumn({ name: 'user_id', type: 'Nullable(UInt64)' }),
    ])
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.ruleId).toBe('nullable_column')
    expect(f.category).toBe('schema')
    expect(f.target).toBe('db.events.user_id')
    expect(f.ddl).toContain('MODIFY COLUMN `user_id` UInt64')
    expect(f.verifyQuery).toContain('IS NULL')
    expect(f.estimatedBytesSaved).toBeGreaterThan(0)
  })
  test('ignores non-Nullable columns', () => {
    expect(ruleNullableColumns([makeColumn({ type: 'UInt64' })])).toEqual([])
  })
})

describe('ruleOversizedIntegers', () => {
  test('flags Int64 with a narrower proposal and a min/max verify query', () => {
    const findings = ruleOversizedIntegers([
      makeColumn({ name: 'n', type: 'UInt64', rows: 1_000_000 }),
    ])
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.ddl).toContain('MODIFY COLUMN `n` UInt32')
    expect(f.verifyQuery).toContain('min(')
    expect(f.verifyQuery).toContain('max(')
    // 4 bytes/row saved × 1M rows.
    expect(f.estimatedBytesSaved).toBe(4_000_000)
  })
  test('does not flag already-small integers or non-integers', () => {
    expect(ruleOversizedIntegers([makeColumn({ type: 'UInt8' })])).toEqual([])
    expect(ruleOversizedIntegers([makeColumn({ type: 'String' })])).toEqual([])
    // Wrapped types are not bare integers — out of scope for this rule.
    expect(
      ruleOversizedIntegers([makeColumn({ type: 'Nullable(UInt64)' })])
    ).toEqual([])
  })
})

describe('ruleCompressionCodec', () => {
  test('suggests DoubleDelta for a default-codec DateTime column', () => {
    const findings = ruleCompressionCodec([
      makeColumn({ name: 'ts', type: 'DateTime', compressionCodec: '' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].ddl).toContain('CODEC(DoubleDelta, ZSTD(1))')
  })
  test('suggests Gorilla for a Float column', () => {
    const findings = ruleCompressionCodec([
      makeColumn({ name: 'v', type: 'Float64' }),
    ])
    expect(findings[0].ddl).toContain('CODEC(Gorilla, ZSTD(1))')
  })
  test('suggests ZSTD for a poorly-compressing large String', () => {
    const findings = ruleCompressionCodec(
      [
        makeColumn({
          type: 'String',
          compressedBytes: 30,
          uncompressedBytes: 40,
        }),
      ].map((c) => ({
        ...c,
        compressedBytes: 30_000_000,
        uncompressedBytes: 40_000_000,
      }))
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].ddl).toContain('CODEC(ZSTD(3))')
  })
  test('skips columns that already have an explicit codec', () => {
    expect(
      ruleCompressionCodec([
        makeColumn({ type: 'DateTime', compressionCodec: 'ZSTD(1)' }),
      ])
    ).toEqual([])
  })
  test('skips small columns below the byte threshold', () => {
    expect(
      ruleCompressionCodec([
        makeColumn({ type: 'DateTime', compressedBytes: 1000 }),
      ])
    ).toEqual([])
  })

  describe('explicit codecs', () => {
    test('does not question a sensible explicit codec on an integer', () => {
      expect(
        ruleCompressionCodec([
          makeColumn({
            type: 'UInt64',
            compressionCodec: 'CODEC(Delta(8), ZSTD(1))',
          }),
        ])
      ).toEqual([])
    })
    test('does not question DoubleDelta on a DateTime or Nullable integer', () => {
      expect(
        ruleCompressionCodec([
          makeColumn({
            type: 'DateTime',
            compressionCodec: 'CODEC(DoubleDelta, ZSTD(1))',
          }),
          makeColumn({
            type: 'Nullable(Int32)',
            compressionCodec: 'CODEC(DoubleDelta, LZ4)',
          }),
        ])
      ).toEqual([])
    })
    test('flags Delta on a Float column and proposes Gorilla', () => {
      const findings = ruleCompressionCodec([
        makeColumn({
          type: 'Float64',
          compressionCodec: 'CODEC(Delta(8), LZ4)',
        }),
      ])
      expect(findings).toHaveLength(1)
      expect(findings[0].title).toContain('Review')
      expect(findings[0].rationale).toContain('Gorilla')
      expect(findings[0].ddl).toContain('CODEC(Gorilla, ZSTD(1))')
    })
    test('flags DoubleDelta on Float32 even inside the sorting key', () => {
      const findings = ruleCompressionCodec([
        makeColumn({
          type: 'Float32',
          compressionCodec: 'CODEC(DoubleDelta, ZSTD(1))',
          isInSortingKey: true,
        }),
      ])
      expect(findings).toHaveLength(1)
    })
    test('flags DoubleDelta on a non-integer column outside the sorting key', () => {
      const col = {
        type: "Enum8('a' = 1, 'b' = 2)",
        compressionCodec: 'CODEC(DoubleDelta, ZSTD(1))',
      }
      expect(
        ruleCompressionCodec([makeColumn({ ...col, isInSortingKey: false })])
      ).toHaveLength(1)
      expect(ruleCompressionCodec([makeColumn(col)])).toHaveLength(1)
      expect(
        ruleCompressionCodec([makeColumn({ ...col, isInSortingKey: true })])
      ).toEqual([])
    })
    test('claims no saving when the questioned column already compresses well', () => {
      const [f] = ruleCompressionCodec([
        makeColumn({
          type: 'Float64',
          compressionCodec: 'CODEC(Delta(8), LZ4)',
          compressedBytes: 10_000_000,
          uncompressedBytes: 80_000_000,
        }),
      ])
      expect(f.estimatedBytesSaved).toBe(0)
      expect(f.estimatedBenefit).toContain('already compresses at 8.0x')
    })
  })

  describe('measured compression ratio', () => {
    test('saved bytes follow the column ratio, not a fixed fraction', () => {
      // ratio 2x vs target 6x -> headroom 0.67, capped at 0.4 of on-disk size.
      const [low] = ruleCompressionCodec([
        makeColumn({
          type: 'DateTime',
          compressedBytes: 12_000_000,
          uncompressedBytes: 24_000_000,
        }),
      ])
      expect(low.estimatedBytesSaved).toBe(4_800_000)
      // ratio 4x -> 1 - 4/6 = 0.333 of on-disk size.
      const [high] = ruleCompressionCodec([
        makeColumn({
          type: 'DateTime',
          compressedBytes: 12_000_000,
          uncompressedBytes: 48_000_000,
        }),
      ])
      expect(high.estimatedBytesSaved).toBe(4_000_000)
      const [higher] = ruleCompressionCodec([
        makeColumn({
          type: 'DateTime',
          compressedBytes: 12_000_000,
          uncompressedBytes: 60_000_000,
        }),
      ])
      // ratio 5x -> 1/6 of size.
      expect(higher.estimatedBytesSaved).toBe(2_000_000)
    })
    test('labels the figure an ESTIMATE based on the current ratio', () => {
      const [f] = ruleCompressionCodec([
        makeColumn({
          type: 'String',
          compressedBytes: 30_000_000,
          uncompressedBytes: 45_000_000,
        }),
      ])
      expect(f.estimatedBenefit).toContain('ESTIMATE')
      expect(f.estimatedBenefit).toContain('current 1.5x compression ratio')
    })
    test('skips a default-codec timeseries column already at the target ratio', () => {
      expect(
        ruleCompressionCodec([
          makeColumn({
            type: 'DateTime',
            compressedBytes: 10_000_000,
            uncompressedBytes: 70_000_000,
          }),
        ])
      ).toEqual([])
    })
    test('falls back to the fixed heuristic when byte counts are missing', () => {
      const [f] = ruleCompressionCodec([
        makeColumn({
          type: 'DateTime',
          compressedBytes: 10_000_000,
          uncompressedBytes: 0,
        }),
      ])
      expect(f.estimatedBytesSaved).toBe(4_000_000)
      expect(f.estimatedBenefit).toContain('no byte counts were available')
    })
  })
  test('skips a well-compressing generic column', () => {
    // String, ratio 4x (>= 3), not timeseries → no finding.
    expect(
      ruleCompressionCodec([
        makeColumn({
          type: 'String',
          compressedBytes: 10_000_000,
          uncompressedBytes: 40_000_000,
        }),
      ])
    ).toEqual([])
  })
})

describe('ruleLowCardinality', () => {
  test('flags a large plain String with a distinct-ratio verify query', () => {
    const findings = ruleLowCardinality([
      makeColumn({ name: 's', type: 'String' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].ddl).toContain('LowCardinality(String)')
    expect(findings[0].verifyQuery).toContain('uniqExact')
  })
  test('skips already-LowCardinality and small columns', () => {
    expect(
      ruleLowCardinality([makeColumn({ type: 'LowCardinality(String)' })])
    ).toEqual([])
    expect(
      ruleLowCardinality([
        makeColumn({ type: 'String', compressedBytes: 1000 }),
      ])
    ).toEqual([])
  })
})

describe('runSchemaRules', () => {
  test('aggregates findings across every rule', () => {
    const findings = runSchemaRules([
      makeColumn({ name: 'a', type: 'Nullable(String)' }),
      makeColumn({ name: 'b', type: 'UInt64' }),
      makeColumn({ name: 'c', type: 'DateTime' }),
      makeColumn({ name: 'd', type: 'String' }),
    ])
    const ids = new Set(findings.map((f) => f.ruleId))
    expect(ids.has('nullable_column')).toBe(true)
    expect(ids.has('oversized_integer')).toBe(true)
    expect(ids.has('compression_codec')).toBe(true)
    expect(ids.has('low_cardinality')).toBe(true)
  })
})

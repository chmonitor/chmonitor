import {
  classifyEngine,
  engineKindLabel,
  formatTimestamp,
  hasPartStorage,
  isEpochZero,
  parseMaterializedViewTarget,
} from './engine-kind'
import { describe, expect, test } from 'bun:test'

describe('classifyEngine', () => {
  test('classifies the MergeTree family (incl. replicated/shared variants)', () => {
    for (const engine of [
      'MergeTree',
      'ReplacingMergeTree',
      'ReplicatedMergeTree',
      'ReplicatedSummingMergeTree',
      'SharedMergeTree',
    ]) {
      expect(classifyEngine(engine)).toBe('mergetree')
    }
  })

  test('classifies dictionaries and views distinctly', () => {
    expect(classifyEngine('Dictionary')).toBe('dictionary')
    expect(classifyEngine('View')).toBe('view')
    expect(classifyEngine('LiveView')).toBe('view')
    expect(classifyEngine('MaterializedView')).toBe('materialized-view')
  })

  test('classifies log and integration engines', () => {
    expect(classifyEngine('TinyLog')).toBe('log')
    expect(classifyEngine('Distributed')).toBe('integration')
    expect(classifyEngine('Kafka')).toBe('integration')
  })

  test('falls back to other for unknown/missing engines', () => {
    expect(classifyEngine(undefined)).toBe('other')
    expect(classifyEngine('')).toBe('other')
    expect(classifyEngine('SomethingNew')).toBe('other')
  })
})

describe('hasPartStorage', () => {
  test('only MergeTree-family objects expose part-based storage stats', () => {
    // This is what keeps "Partitions 0 / Active parts 0" off a Dictionary.
    expect(hasPartStorage(classifyEngine('MergeTree'))).toBe(true)
    expect(hasPartStorage(classifyEngine('Dictionary'))).toBe(false)
    expect(hasPartStorage(classifyEngine('View'))).toBe(false)
    expect(hasPartStorage(classifyEngine('MaterializedView'))).toBe(false)
  })
})

describe('engineKindLabel', () => {
  test('names the object type for headers', () => {
    expect(engineKindLabel(classifyEngine('Dictionary'))).toBe('Dictionary')
    expect(engineKindLabel(classifyEngine('MaterializedView'))).toBe(
      'Materialized view'
    )
    expect(engineKindLabel(classifyEngine('MergeTree'))).toBe('Table')
  })
})

describe('parseMaterializedViewTarget', () => {
  test('extracts the TO target of a materialized view', () => {
    expect(
      parseMaterializedViewTarget(
        'CREATE MATERIALIZED VIEW default.mv TO default.dest (`a` UInt8) AS SELECT a FROM src'
      )
    ).toBe('default.dest')
  })

  test('strips backticks from quoted identifiers', () => {
    expect(
      parseMaterializedViewTarget(
        'CREATE MATERIALIZED VIEW `db`.`mv` TO `my db`.`my table` AS SELECT 1'
      )
    ).toBe('my db.my table')
  })

  test('returns null for an inner-table MV or a plain view', () => {
    expect(
      parseMaterializedViewTarget(
        'CREATE MATERIALIZED VIEW default.mv ENGINE = MergeTree ORDER BY a AS SELECT a FROM src'
      )
    ).toBeNull()
    expect(parseMaterializedViewTarget('')).toBeNull()
    expect(parseMaterializedViewTarget(null)).toBeNull()
  })
})

describe('isEpochZero', () => {
  test('detects ClickHouse epoch-zero datetimes regardless of timezone', () => {
    // Parsed as local time, so getTime() is non-zero in most timezones —
    // the check must be year-based, not `getTime() === 0`.
    expect(isEpochZero('1970-01-01 00:00:00')).toBe(true)
    expect(isEpochZero(0)).toBe(true)
  })

  test('does not flag real timestamps', () => {
    expect(isEpochZero('2026-08-12 10:00:00')).toBe(false)
  })
})

describe('formatTimestamp', () => {
  test('renders epoch-zero as the fallback, never 1/1/1970', () => {
    const result = formatTimestamp('1970-01-01 00:00:00')
    expect(result.relative).toBe('never')
    expect(result.absolute).toBeNull()
  })

  test('renders missing/invalid values as the fallback', () => {
    expect(formatTimestamp(null).relative).toBe('never')
    expect(formatTimestamp('').relative).toBe('never')
    expect(formatTimestamp('not-a-date').relative).toBe('never')
    expect(formatTimestamp(undefined, '—').relative).toBe('—')
  })

  test('renders a real timestamp as relative plus absolute', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const result = formatTimestamp(twoHoursAgo.toISOString())
    expect(result.relative).toBe('2h ago')
    expect(result.absolute).toBe(twoHoursAgo.toLocaleString())
  })
})

import {
  DEFAULT_SOURCE_ENGINE,
  isSourceEngine,
  parseSourceEngine,
  SOURCE_ENGINES,
  type SourceEngine,
} from '../source-engine'
import { describe, expect, it } from 'bun:test'

describe('SOURCE_ENGINES', () => {
  it('lists exactly the three supported engines in display order', () => {
    expect(SOURCE_ENGINES).toEqual([
      'clickhouse',
      'clickhouse-cloud',
      'postgres',
    ])
  })

  it('defaults to clickhouse (fail-closed)', () => {
    expect(DEFAULT_SOURCE_ENGINE).toBe('clickhouse')
  })
})

describe('isSourceEngine', () => {
  it('accepts every known engine', () => {
    for (const engine of SOURCE_ENGINES) {
      expect(isSourceEngine(engine)).toBe(true)
    }
  })

  it('rejects junk / unknown strings and non-strings', () => {
    for (const value of [
      'postgresql',
      'ch',
      'ClickHouse',
      '',
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isSourceEngine(value)).toBe(false)
    }
  })
})

describe('parseSourceEngine', () => {
  it('returns the engine unchanged when valid', () => {
    for (const engine of SOURCE_ENGINES) {
      expect(parseSourceEngine(engine)).toBe(engine)
    }
  })

  it('falls back to clickhouse for null/undefined (legacy rows)', () => {
    expect(parseSourceEngine(null)).toBe('clickhouse')
    expect(parseSourceEngine(undefined)).toBe('clickhouse')
  })

  it('falls back to clickhouse for junk instead of trusting it', () => {
    const result: SourceEngine = parseSourceEngine('mysql')
    expect(result).toBe('clickhouse')
  })
})

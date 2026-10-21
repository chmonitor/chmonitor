import {
  createFailedProbeMemory,
  prepareSampleSql,
  QUERY_LOG_CUT_LENGTH,
} from './explain-probe-memory'
import { describe, expect, test } from 'bun:test'

describe('createFailedProbeMemory', () => {
  test('remembers a hash until the TTL elapses, then forgets it', () => {
    let t = 1_000
    const memory = createFailedProbeMemory({ ttlMs: 100, now: () => t })
    memory.add('a')
    t = 1_099
    expect(memory.has('a')).toBe(true)
    t = 1_100
    expect(memory.has('a')).toBe(false)
  })

  test('is bounded: the oldest entry is evicted past maxEntries', () => {
    const memory = createFailedProbeMemory({ maxEntries: 2, now: () => 0 })
    memory.add('a')
    memory.add('b')
    memory.add('c')
    expect(memory.size).toBe(2)
    expect(memory.has('a')).toBe(false)
    expect(memory.has('b')).toBe(true)
    expect(memory.has('c')).toBe(true)
  })
})

describe('prepareSampleSql', () => {
  test('strips a trailing FORMAT clause and semicolons', () => {
    expect(prepareSampleSql('SELECT 1 FROM t FORMAT JSONEachRow')).toBe(
      'SELECT 1 FROM t'
    )
    expect(prepareSampleSql('SELECT 1 FROM t;  ')).toBe('SELECT 1 FROM t')
    expect(prepareSampleSql('SELECT 1 FROM t FORMAT TSV;\n')).toBe(
      'SELECT 1 FROM t'
    )
  })

  test('keeps a FORMAT that is not trailing', () => {
    const sql = "SELECT formatReadableSize(x) FROM t WHERE y = 'FORMAT a b'"
    expect(prepareSampleSql(sql)).toBe(sql)
  })

  test('rejects text cut by log_queries_cut_to_length and empty text', () => {
    expect(prepareSampleSql('S'.repeat(QUERY_LOG_CUT_LENGTH))).toBeNull()
    expect(prepareSampleSql(' ; ')).toBeNull()
  })
})

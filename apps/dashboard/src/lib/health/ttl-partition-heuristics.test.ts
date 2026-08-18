import {
  evaluateTtlPartitionHealth,
  hasTtlExpression,
  isTimeBasedPartitionKey,
  PARTITION_COUNT_CRITICAL,
  PARTITION_COUNT_WARNING,
  ttlPartitionRowClassName,
} from './ttl-partition-heuristics'
import { describe, expect, test } from 'bun:test'

describe('isTimeBasedPartitionKey', () => {
  test('flags toYYYYMMDD and related helpers', () => {
    expect(isTimeBasedPartitionKey('toYYYYMMDD(event_time)')).toBe(true)
    expect(isTimeBasedPartitionKey('toYYYYMM(created_at)')).toBe(true)
    expect(isTimeBasedPartitionKey('toStartOfDay(ts)')).toBe(true)
    expect(isTimeBasedPartitionKey('toMonday(ts)')).toBe(true)
  })

  test('does not flag city or hash keys', () => {
    expect(isTimeBasedPartitionKey('city_id')).toBe(false)
    expect(isTimeBasedPartitionKey('sipHash64(user_id)')).toBe(false)
    expect(isTimeBasedPartitionKey('')).toBe(false)
  })
})

describe('hasTtlExpression', () => {
  test('empty and whitespace are missing', () => {
    expect(hasTtlExpression('')).toBe(false)
    expect(hasTtlExpression('   ')).toBe(false)
    expect(hasTtlExpression(null)).toBe(false)
  })

  test('any expression counts', () => {
    expect(hasTtlExpression('event_time + INTERVAL 30 DAY')).toBe(true)
  })
})

describe('evaluateTtlPartitionHealth', () => {
  test('toYYYYMMDD with 500+ partitions flags high count', () => {
    const result = evaluateTtlPartitionHealth({
      database: 'logs',
      table: 'events',
      partitionKey: 'toYYYYMMDD(event_time)',
      ttlExpression: 'event_time + INTERVAL 90 DAY',
      partitions: PARTITION_COUNT_WARNING,
      activeParts: PARTITION_COUNT_WARNING,
    })
    expect(result.flags).toContain('high_partition_count')
    expect(result.severity).toBe('warning')
  })

  test('1000+ partitions is critical', () => {
    const result = evaluateTtlPartitionHealth({
      database: 'logs',
      table: 'events',
      partitionKey: 'toYYYYMMDD(event_time)',
      ttlExpression: 'event_time + INTERVAL 90 DAY',
      partitions: PARTITION_COUNT_CRITICAL,
      activeParts: PARTITION_COUNT_CRITICAL,
    })
    expect(result.flags).toContain('too_many_partitions')
    expect(result.severity).toBe('critical')
  })

  test('time-based partition key with no TTL still appears as missing_ttl', () => {
    const result = evaluateTtlPartitionHealth({
      database: 'logs',
      table: 'events',
      partitionKey: 'toYYYYMMDD(event_time)',
      ttlExpression: '',
      partitions: 12,
      activeParts: 12,
    })
    expect(result.flags).toContain('missing_ttl')
    expect(result.severity).toBe('warning')
  })

  test('tables with no TTL and a non-time key are ok', () => {
    const result = evaluateTtlPartitionHealth({
      database: 'dim',
      table: 'users',
      partitionKey: 'city_id',
      ttlExpression: '',
      partitions: 8,
      activeParts: 16,
    })
    expect(result.flags).toEqual([])
    expect(result.severity).toBe('ok')
  })

  test('high parts per partition is info when nothing else is wrong', () => {
    const result = evaluateTtlPartitionHealth({
      database: 'dim',
      table: 'users',
      partitionKey: 'city_id',
      ttlExpression: '',
      partitions: 2,
      activeParts: 40,
    })
    expect(result.flags).toContain('high_parts_per_partition')
    expect(result.severity).toBe('info')
  })
})

describe('ttlPartitionRowClassName', () => {
  test('highlights warning rows from query-shaped objects', () => {
    const cls = ttlPartitionRowClassName({
      database: 'logs',
      table: 'events',
      partition_key: 'toYYYYMMDD(ts)',
      ttl_expression: '',
      partitions: 10,
      active_parts: 10,
    })
    expect(cls).toContain('amber')
  })

  test('leaves healthy rows unstyled', () => {
    expect(
      ttlPartitionRowClassName({
        database: 'dim',
        table: 'users',
        partition_key: 'id',
        ttl_expression: '',
        partitions: 1,
        active_parts: 1,
      })
    ).toBeUndefined()
  })
})

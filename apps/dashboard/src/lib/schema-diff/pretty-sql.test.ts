import { prettySchemaSql } from './pretty-sql'
import { describe, expect, test } from 'bun:test'

describe('prettySchemaSql', () => {
  test('puts each CREATE TABLE column on its own line', () => {
    const sql =
      "CREATE TABLE peerdb.id_8_terminal_trip_raw (`id` Int64, `ts` DateTime64(3, 'UTC') DEFAULT now(), `name` String) ENGINE = MergeTree ORDER BY id"
    const pretty = prettySchemaSql(sql)
    expect(pretty).toBe(
      [
        'CREATE TABLE peerdb.id_8_terminal_trip_raw',
        '(',
        '  `id` Int64,',
        "  `ts` DateTime64(3, 'UTC') DEFAULT now(),",
        '  `name` String',
        ')',
        'ENGINE = MergeTree',
        'ORDER BY id',
      ].join('\n')
    )
  })

  test('keeps nested type arguments and codecs on the column line', () => {
    const sql =
      'CREATE TABLE analytics.events (`event_date` Date, `user_id` UInt64, `event_type` LowCardinality(String), `payload` String CODEC(ZSTD(1))) ENGINE = MergeTree PARTITION BY toYYYYMM(event_date) ORDER BY (event_date, user_id)'
    const pretty = prettySchemaSql(sql)
    expect(pretty).toContain('  `event_type` LowCardinality(String),')
    expect(pretty).toContain('  `payload` String CODEC(ZSTD(1))')
    expect(pretty).toContain('PARTITION BY toYYYYMM(event_date)')
    expect(pretty).toContain('ORDER BY (event_date, user_id)')
    expect(pretty.split('\n')[0]).toBe('CREATE TABLE analytics.events')
  })

  test('leaves non-CREATE TABLE SQL unchanged aside from trim', () => {
    expect(prettySchemaSql('  SELECT 1  ')).toBe('SELECT 1')
  })

  test('is a no-op when the column list cannot be parsed', () => {
    expect(prettySchemaSql('CREATE TABLE broken (id UInt64')).toBe(
      'CREATE TABLE broken (id UInt64'
    )
  })
})

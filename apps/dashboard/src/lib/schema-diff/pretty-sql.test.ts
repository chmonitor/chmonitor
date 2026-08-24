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

  test('still pretty-prints when UUID / ON CLUSTER / quoted names precede columns', () => {
    const uuid =
      "CREATE TABLE default.foo UUID '01234567-89ab-cdef-0123-456789abcdef' (`id` Int64, `name` String) ENGINE = MergeTree ORDER BY id"
    const clustered =
      "CREATE TABLE default.foo ON CLUSTER '{cluster}' (`id` UInt64) ENGINE = ReplicatedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') ORDER BY id"
    const quoted =
      'CREATE TABLE `default`.`events` (`id` UInt64, `payload` String CODEC(ZSTD(1))) ENGINE = MergeTree PARTITION BY toYYYYMM(d) ORDER BY id SETTINGS index_granularity = 8192'

    const uuidPretty = prettySchemaSql(uuid)
    expect(uuidPretty).toContain('\n(\n  `id` Int64,\n  `name` String\n)')
    expect(uuidPretty).toContain('ENGINE = MergeTree')

    const clusteredPretty = prettySchemaSql(clustered)
    expect(clusteredPretty.split('\n')[0]).toBe(
      "CREATE TABLE default.foo ON CLUSTER '{cluster}'"
    )
    expect(clusteredPretty).toContain('  `id` UInt64')
    expect(clusteredPretty).toContain('ENGINE = ReplicatedMergeTree')

    const quotedPretty = prettySchemaSql(quoted)
    expect(quotedPretty.split('\n')[0]).toBe('CREATE TABLE `default`.`events`')
    expect(quotedPretty).toContain('  `id` UInt64,')
    expect(quotedPretty).toContain('  `payload` String CODEC(ZSTD(1))')
    expect(quotedPretty).toContain('PARTITION BY toYYYYMM(d)')
    expect(quotedPretty).toContain('SETTINGS index_granularity = 8192')
  })
})

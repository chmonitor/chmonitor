import {
  annotateDdlForTopology,
  insertOnClusterClause,
  rewriteDdlTableName,
  topologyFromDistributedTable,
} from './on-cluster'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALTER = 'ALTER TABLE `app`.`events_dist` ADD COLUMN `note` String'

describe('annotateDdlForTopology', () => {
  test('Distributed/cluster fixture exposes local table and copyable ON CLUSTER variant', () => {
    const result = annotateDdlForTopology(ALTER, {
      cluster: 'analytics',
      localDatabase: 'default',
      localTable: 'events_local',
    })

    expect(result.localTableName).toBe('default.events_local')
    expect(result.statement).toBe(
      'ALTER TABLE `default`.`events_local` ADD COLUMN `note` String'
    )
    expect(result.onClusterStatement).toBe(
      "ALTER TABLE `default`.`events_local` ON CLUSTER 'analytics' ADD COLUMN `note` String"
    )
    expect(result.onClusterStatement).toContain('ADD COLUMN `note` String')
    expect(result.onClusterStatement).not.toBe(result.statement)
    expect(result.localOnlyReason).toBeNull()
  })

  test('single-node / empty topology leaves single-host SQL unchanged', () => {
    const empty = annotateDdlForTopology(ALTER, null)
    expect(empty.statement).toBe(ALTER)
    expect(empty.onClusterStatement).toBeNull()
    expect(empty.localTableName).toBeNull()
    expect(empty.localOnlyReason).toBeNull()

    const blank = annotateDdlForTopology(ALTER, { cluster: '' })
    expect(blank.statement).toBe(ALTER)
    expect(blank.onClusterStatement).toBeNull()
  })

  test('Replicated table with cluster metadata keeps the same table and adds ON CLUSTER', () => {
    const stmt =
      'ALTER TABLE `app`.`events` ADD INDEX `idx_note` note TYPE bloom_filter GRANULARITY 1'
    const result = annotateDdlForTopology(stmt, {
      cluster: 'prod',
      localDatabase: 'app',
      localTable: 'events',
    })
    expect(result.localTableName).toBe('app.events')
    expect(result.statement).toContain('`app`.`events`')
    expect(result.onClusterStatement).toContain("ON CLUSTER 'prod'")
    expect(result.onClusterStatement).toContain('ADD INDEX `idx_note`')
  })

  test('CREATE TABLE gets ON CLUSTER after the table identifier', () => {
    const create =
      'CREATE TABLE app.new_tbl (`id` UInt64) ENGINE = MergeTree ORDER BY id'
    const result = annotateDdlForTopology(create, {
      cluster: 'analytics',
      localDatabase: 'app',
      localTable: 'new_tbl',
    })
    expect(result.onClusterStatement).toBe(
      "CREATE TABLE `app`.`new_tbl` ON CLUSTER 'analytics' (`id` UInt64) ENGINE = MergeTree ORDER BY id"
    )
  })

  test('non-DDL (PREWHERE / SET) stays local-only with an explicit reason', () => {
    const rewrite = "SELECT * FROM events PREWHERE status = 'error'"
    const result = annotateDdlForTopology(rewrite, {
      cluster: 'analytics',
      localDatabase: 'default',
      localTable: 'events_local',
    })
    expect(result.statement).toBe(rewrite)
    expect(result.onClusterStatement).toBeNull()
    expect(result.localOnlyReason).toMatch(/not table DDL/i)
  })

  test('does not invoke any execute/apply helper', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'on-cluster.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/\bfetchData\b/)
    expect(src).not.toMatch(/\bexecuteDdl\b/)
    expect(src).not.toMatch(/\bapplyDdl\b/)
    expect(src).not.toMatch(/clickhouse-client/)
    expect(src).not.toMatch(/readOnlyQuery/)

    const result = annotateDdlForTopology(ALTER, {
      cluster: 'analytics',
      localDatabase: 'default',
      localTable: 'events_local',
    })
    expect(typeof result.statement).toBe('string')
    expect(typeof result.onClusterStatement).toBe('string')
  })
})

describe('insertOnClusterClause / rewriteDdlTableName', () => {
  test('is idempotent when ON CLUSTER is already present', () => {
    const already =
      "ALTER TABLE `app`.`t` ON CLUSTER 'analytics' ADD COLUMN x UInt8"
    expect(insertOnClusterClause(already, 'analytics')).toBe(already)
  })

  test('rewrites only the table identifier', () => {
    expect(rewriteDdlTableName(ALTER, 'default', 'events_local')).toBe(
      'ALTER TABLE `default`.`events_local` ADD COLUMN `note` String'
    )
  })
})

describe('topologyFromDistributedTable', () => {
  test('parses ENGINE = Distributed from CREATE TABLE', () => {
    const topology = topologyFromDistributedTable({
      engine: 'Distributed',
      createTableQuery:
        "CREATE TABLE app.events_dist (`id` UInt64) ENGINE = Distributed('analytics', 'default', 'events_local', rand())",
    })
    expect(topology).toEqual({
      cluster: 'analytics',
      localDatabase: 'default',
      localTable: 'events_local',
    })
  })

  test('returns null for MergeTree / missing engine', () => {
    expect(
      topologyFromDistributedTable({
        engine: 'MergeTree',
        createTableQuery:
          'CREATE TABLE app.t (`id` UInt64) ENGINE = MergeTree ORDER BY id',
      })
    ).toBeNull()
    expect(topologyFromDistributedTable({})).toBeNull()
  })
})

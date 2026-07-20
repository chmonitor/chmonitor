/**
 * SQL-generation tests for the ClickHouse dashboard store, run against a
 * mocked state-ClickHouse executor (no live ClickHouse required). Verifies
 * the DDL shape (ReplacingMergeTree keyed by owner), that every read/write
 * is owner-scoped via bound params (never string interpolation), that reads
 * use FINAL, and the empty-share-slug guard.
 */

import type { StateClickHouseExecutor } from '@/lib/state-backend/clickhouse-client'
import type { StateClickHouseConfig } from '@/lib/state-backend/config'

import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => undefined }),
}))

const { buildDashboardsDdl, ClickHouseDashboardStore } = await import(
  './clickhouse-store'
)

const CONFIG: StateClickHouseConfig = {
  url: 'http://ch:8123',
  user: 'default',
  password: '',
  database: 'chmonitor',
  tablePrefix: 'chm_state_',
}

interface Call {
  kind: 'command' | 'query'
  sql: string
  params?: Record<string, string | number>
}

function mockExecutor(queryResult: unknown[] = []) {
  const calls: Call[] = []
  const executor: StateClickHouseExecutor = {
    async command(sql, params) {
      calls.push({ kind: 'command', sql, params })
    },
    async query<T>(sql: string, params?: Record<string, string | number>) {
      calls.push({ kind: 'query', sql, params })
      return queryResult as T[]
    },
  }
  return { executor, calls }
}

describe('buildDashboardsDdl', () => {
  test('creates a ReplacingMergeTree versioned by updated_at, keyed (owner_id, name)', () => {
    const ddl = buildDashboardsDdl('chmonitor', 'chm_state_')
    expect(ddl).toContain(
      'CREATE TABLE IF NOT EXISTS chmonitor.chm_state_dashboards'
    )
    expect(ddl).toContain('ENGINE = ReplacingMergeTree(updated_at)')
    expect(ddl).toContain('ORDER BY (owner_id, name)')
  })

  test('honors a custom database and table prefix', () => {
    expect(buildDashboardsDdl('ops', 'ui_')).toContain(
      'CREATE TABLE IF NOT EXISTS ops.ui_dashboards'
    )
  })
})

describe('ClickHouseDashboardStore SQL', () => {
  test('lazily creates database + table before the first read', async () => {
    const { executor, calls } = mockExecutor()
    const store = new ClickHouseDashboardStore(CONFIG, executor)
    await store.list('owner-a')
    expect(calls[0]?.sql).toBe('CREATE DATABASE IF NOT EXISTS chmonitor')
    expect(calls[1]?.sql).toContain('CREATE TABLE IF NOT EXISTS')
  })

  test('list is owner-scoped, reads FINAL, and binds params', async () => {
    const { executor, calls } = mockExecutor()
    const store = new ClickHouseDashboardStore(CONFIG, executor)
    await store.list('owner-a')
    const listCall = calls.at(-1)
    expect(listCall?.sql).toContain('FROM chmonitor.chm_state_dashboards FINAL')
    expect(listCall?.sql).toContain('owner_id = {owner_id:String}')
    expect(listCall?.params).toEqual({ owner_id: 'owner-a' })
  })

  test('saveByName inserts a full row with bound params (no interpolation)', async () => {
    const { executor, calls } = mockExecutor()
    const store = new ClickHouseDashboardStore(CONFIG, executor)
    const saved = await store.saveByName('owner-a', 'My Board', { widgets: [] })
    const insert = calls.find((c) => c.sql.includes('INSERT INTO'))
    expect(insert?.sql).toContain('INSERT INTO chmonitor.chm_state_dashboards')
    expect(insert?.params).toMatchObject({
      owner_id: 'owner-a',
      name: 'My Board',
      is_shared: 0,
      share_slug: '',
    })
    // The raw layout/name never appear inside the SQL text itself.
    expect(insert?.sql).not.toContain('My Board')
    expect(saved.ownerId).toBe('owner-a')
    expect(saved.shareSlug).toBeNull()
  })

  test('delete is owner-scoped via a lightweight DELETE', async () => {
    const { executor, calls } = mockExecutor()
    const store = new ClickHouseDashboardStore(CONFIG, executor)
    await store.delete('owner-a', 'My Board')
    const del = calls.find((c) => c.sql.startsWith('DELETE FROM'))
    expect(del?.sql).toContain(
      'WHERE owner_id = {owner_id:String} AND name = {name:String}'
    )
    expect(del?.params).toEqual({ owner_id: 'owner-a', name: 'My Board' })
  })

  test('getByShareSlug requires is_shared = 1 and never matches the empty slug', async () => {
    const { executor, calls } = mockExecutor()
    const store = new ClickHouseDashboardStore(CONFIG, executor)

    // Empty string means "no slug" in storage — must short-circuit to null
    // without ever querying.
    expect(await store.getByShareSlug('')).toBeNull()
    expect(calls.filter((c) => c.kind === 'query')).toHaveLength(0)

    await store.getByShareSlug('slug-1')
    const read = calls.find((c) => c.kind === 'query')
    expect(read?.sql).toContain('share_slug = {slug:String} AND is_shared = 1')
    expect(read?.params).toEqual({ slug: 'slug-1' })
  })

  test('setSharing revokes by clearing the slug in the same write', async () => {
    const existingRow = {
      id: 'id-1',
      owner_id: 'owner-a',
      name: 'My Board',
      layout_json: '{"widgets":[]}',
      is_shared: 1,
      share_slug: 'slug-1',
      updated_at: 1,
    }
    const { executor, calls } = mockExecutor([existingRow])
    const store = new ClickHouseDashboardStore(CONFIG, executor)
    const revoked = await store.setSharing('owner-a', 'My Board', false)
    expect(revoked?.isShared).toBe(false)
    expect(revoked?.shareSlug).toBeNull()
    const insert = calls.find((c) => c.sql.includes('INSERT INTO'))
    expect(insert?.params).toMatchObject({ is_shared: 0, share_slug: '' })
  })
})

/**
 * SQL-generation tests for the ClickHouse connection store, run against a
 * mocked state-ClickHouse executor (no live ClickHouse required). Verifies
 * the DDL shape, user scoping via bound params, FINAL reads, and the
 * delete-not-found contract.
 */

import type { StateClickHouseExecutor } from '@/lib/state-backend/clickhouse-client'
import type { StateClickHouseConfig } from '@/lib/state-backend/config'

import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => undefined }),
}))

const { buildConnectionsDdl, ClickHouseConnectionStore } = await import(
  './clickhouse-store'
)
const { ConnectionStoreError } = await import('./types')

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

const ROW = {
  id: 'conn-1',
  user_id: 'user-a',
  name: 'Prod',
  host_url: 'https://ch.example:8443',
  ch_user: 'monitor',
  host_id: -1000,
  engine: 'clickhouse',
  encrypted_payload: 'payload',
  created_at: 1,
  updated_at: 1,
}

describe('buildConnectionsDdl', () => {
  test('creates a ReplacingMergeTree versioned by updated_at, keyed (user_id, id)', () => {
    const ddl = buildConnectionsDdl('chmonitor', 'chm_state_')
    expect(ddl).toContain(
      'CREATE TABLE IF NOT EXISTS chmonitor.chm_state_user_connections'
    )
    expect(ddl).toContain('ENGINE = ReplacingMergeTree(updated_at)')
    expect(ddl).toContain('ORDER BY (user_id, id)')
  })
})

describe('ClickHouseConnectionStore SQL', () => {
  test('lazily creates database + table before the first read', async () => {
    const { executor, calls } = mockExecutor()
    const store = new ClickHouseConnectionStore(CONFIG, executor)
    await store.list('user-a')
    expect(calls[0]?.sql).toBe('CREATE DATABASE IF NOT EXISTS chmonitor')
    expect(calls[1]?.sql).toContain('CREATE TABLE IF NOT EXISTS')
  })

  test('list is user-scoped, reads FINAL, and binds params', async () => {
    const { executor, calls } = mockExecutor([ROW])
    const store = new ClickHouseConnectionStore(CONFIG, executor)
    const metas = await store.list('user-a')
    const listCall = calls.find((c) => c.kind === 'query')
    expect(listCall?.sql).toContain(
      'FROM chmonitor.chm_state_user_connections FINAL'
    )
    expect(listCall?.sql).toContain('user_id = {user_id:String}')
    expect(listCall?.params).toEqual({ user_id: 'user-a' })
    // Row mapping (and no encrypted payload in list metadata).
    expect(metas[0]).toMatchObject({
      id: 'conn-1',
      userId: 'user-a',
      hostId: -1000,
      engine: 'clickhouse',
    })
    expect(metas[0]).not.toHaveProperty('encryptedPayload')
  })

  test('get scopes by user AND id with bound params', async () => {
    const { executor, calls } = mockExecutor([ROW])
    const store = new ClickHouseConnectionStore(CONFIG, executor)
    const stored = await store.get('user-a', 'conn-1')
    const getCall = calls.find((c) => c.kind === 'query')
    expect(getCall?.sql).toContain(
      'user_id = {user_id:String} AND id = {id:String}'
    )
    expect(getCall?.params).toEqual({ user_id: 'user-a', id: 'conn-1' })
    expect(stored?.encryptedPayload).toBe('payload')
  })

  test('delete issues a user-scoped lightweight DELETE after existence check', async () => {
    const { executor, calls } = mockExecutor([ROW])
    const store = new ClickHouseConnectionStore(CONFIG, executor)
    await store.delete('user-a', 'conn-1')
    const del = calls.find((c) => c.sql.startsWith('DELETE FROM'))
    expect(del?.sql).toContain(
      'WHERE user_id = {user_id:String} AND id = {id:String}'
    )
    expect(del?.params).toEqual({ user_id: 'user-a', id: 'conn-1' })
  })

  test('delete throws NOT_FOUND when the connection does not exist', async () => {
    const { executor } = mockExecutor([])
    const store = new ClickHouseConnectionStore(CONFIG, executor)
    await expect(store.delete('user-a', 'missing')).rejects.toThrow(
      ConnectionStoreError
    )
  })
})

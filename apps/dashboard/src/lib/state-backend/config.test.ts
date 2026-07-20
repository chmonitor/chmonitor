/**
 * Unit tests for the shared state-backend env parsing: opt-in ClickHouse
 * config (defaults + identifier-injection fail-open) and the Postgres URL
 * precedence shared by the three UI-state stores.
 */

import {
  DEFAULT_STATE_CLICKHOUSE_DATABASE,
  DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX,
  getStateClickHouseConfig,
  getStatePostgresUrl,
} from './config'
import { describe, expect, test } from 'bun:test'

describe('getStateClickHouseConfig', () => {
  test('returns null when CHM_STATE_CLICKHOUSE_URL is unset or blank', () => {
    expect(getStateClickHouseConfig({})).toBeNull()
    expect(
      getStateClickHouseConfig({ CHM_STATE_CLICKHOUSE_URL: '   ' })
    ).toBeNull()
  })

  test('applies defaults for user, password, database, and table prefix', () => {
    const config = getStateClickHouseConfig({
      CHM_STATE_CLICKHOUSE_URL: 'http://ch:8123',
    })
    expect(config).toEqual({
      url: 'http://ch:8123',
      user: 'default',
      password: '',
      database: DEFAULT_STATE_CLICKHOUSE_DATABASE,
      tablePrefix: DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX,
    })
  })

  test('uses explicit values when set', () => {
    const config = getStateClickHouseConfig({
      CHM_STATE_CLICKHOUSE_URL: 'https://ch.internal:8443',
      CHM_STATE_CLICKHOUSE_USER: 'state',
      CHM_STATE_CLICKHOUSE_PASSWORD: 'secret',
      CHM_STATE_CLICKHOUSE_DATABASE: 'ops',
      CHM_STATE_CLICKHOUSE_TABLE_PREFIX: 'ui_',
    })
    expect(config).toEqual({
      url: 'https://ch.internal:8443',
      user: 'state',
      password: 'secret',
      database: 'ops',
      tablePrefix: 'ui_',
    })
  })

  test('fails open to defaults on invalid identifiers (DDL injection guard)', () => {
    const config = getStateClickHouseConfig({
      CHM_STATE_CLICKHOUSE_URL: 'http://ch:8123',
      CHM_STATE_CLICKHOUSE_DATABASE: 'bad; DROP TABLE x',
      CHM_STATE_CLICKHOUSE_TABLE_PREFIX: 'evil`--',
    })
    expect(config?.database).toBe(DEFAULT_STATE_CLICKHOUSE_DATABASE)
    expect(config?.tablePrefix).toBe(DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX)
  })
})

describe('getStatePostgresUrl', () => {
  test('returns null when nothing is configured', () => {
    expect(getStatePostgresUrl({})).toBeNull()
  })

  test('precedence: DATABASE_URL > POSTGRES_URL > POSTGRES_PRISMA_URL', () => {
    expect(
      getStatePostgresUrl({
        DATABASE_URL: 'postgres://a',
        POSTGRES_URL: 'postgres://b',
        POSTGRES_PRISMA_URL: 'postgres://c',
      })
    ).toBe('postgres://a')
    expect(
      getStatePostgresUrl({
        POSTGRES_URL: 'postgres://b',
        POSTGRES_PRISMA_URL: 'postgres://c',
      })
    ).toBe('postgres://b')
    expect(getStatePostgresUrl({ POSTGRES_PRISMA_URL: 'postgres://c' })).toBe(
      'postgres://c'
    )
  })
})

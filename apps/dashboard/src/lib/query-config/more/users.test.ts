import type { VersionedSql } from '@/types/query-config'

import {
  pickUsersConfig,
  resolveUsersVariant,
  USERS_LIMIT,
  USERS_MAX_EXECUTION_TIME,
  USERS_VALID_UNTIL_SINCE,
  usersBasicConfig,
  usersConfig,
  usersWithLoginConfig,
} from './users'
import { describe, expect, test } from 'bun:test'
import { getQueryConfigByName } from '@/lib/query-config'
import { ColumnFormat } from '@/types/column-format'

const VARIANTS = [usersConfig, usersWithLoginConfig, usersBasicConfig]

function versions(sql: unknown): VersionedSql[] {
  return sql as VersionedSql[]
}

describe('users config variants', () => {
  test('the page picks the variant matching the log tables the host has', () => {
    expect(pickUsersConfig({ activity: true, login: true })).toBe(
      usersWithLoginConfig
    )
    expect(pickUsersConfig({ activity: true, login: false })).toBe(usersConfig)
    // No query log: the session log alone does not bring activity columns.
    expect(pickUsersConfig({ activity: false, login: true })).toBe(
      usersBasicConfig
    )
  })

  test('each variant only reads the log tables its tableCheck names', () => {
    for (const config of VARIANTS) {
      const checks = ([] as string[]).concat(config.tableCheck ?? [])
      const allSql = versions(config.sql)
        .map((v) => v.sql)
        .join('\n')
      expect(allSql.includes('query_log')).toBe(
        checks.includes('system.query_log')
      )
      expect(allSql.includes('session_log')).toBe(
        checks.includes('system.session_log')
      )
    }
  })

  test('activity and login columns are hidden when their table is missing', () => {
    expect(usersBasicConfig.columns).not.toContain('queries_7d')
    expect(usersBasicConfig.columns).not.toContain('last_login')
    expect(usersConfig.columns).toContain('queries_7d')
    expect(usersConfig.columns).not.toContain('last_login')
    expect(usersWithLoginConfig.columns).toContain('last_login')
  })

  test('valid_until is read only from the release that has it', () => {
    for (const config of VARIANTS) {
      const [old, current] = versions(config.sql)
      expect(old.sql).not.toContain('u.valid_until')
      expect(current.since).toBe(USERS_VALID_UNTIL_SINCE)
      // Epoch means "no expiry"; it must render as never, not 1970-01-01.
      expect(current.sql).toContain("'never'")
      expect(current.sql).toContain('toUnixTimestamp(t)')
    }
  })

  test('activity is bounded on event_date for partition pruning', () => {
    const sql = versions(usersWithLoginConfig.sql)[1].sql
    expect(sql).toMatch(/event_date >= today\(\) - 7\)/)
    expect(sql).toMatch(/event_date >= today\(\) - 30\)/)
  })

  test('the user name links to the per-user usage page on the same host', () => {
    expect(usersConfig.columnFormats?.name).toEqual([
      ColumnFormat.Link,
      { href: '/usage/user?user=[name_param]&host=[ctx.hostId]' },
    ])
    // The template reads a row column; without it the link drops the user.
    for (const config of VARIANTS) {
      for (const { sql } of versions(config.sql)) {
        expect(sql).toContain('encodeURLComponent(u.name) AS name_param')
      }
    }
  })

  test('every variant is registered by name', () => {
    for (const config of VARIANTS) {
      expect(getQueryConfigByName(config.name)?.name).toBe(config.name)
    }
  })
})
describe('users list cost and gating', () => {
  test('does not poll: each refresh rescans the query log', () => {
    for (const config of VARIANTS) expect(config.refreshInterval).toBe(0)
  })

  test('the scan is time-boxed and the row cap is documented on the page', () => {
    for (const config of VARIANTS) {
      expect(config.clickhouseSettings?.max_execution_time).toBe(
        USERS_MAX_EXECUTION_TIME
      )
      expect(config.description).toContain(`at most ${USERS_LIMIT} accounts`)
      for (const { sql } of versions(config.sql))
        expect(sql).toContain(`LIMIT ${USERS_LIMIT}`)
    }
  })

  test('variants reading a log table are optional so a host without it answers empty, not 404', () => {
    expect(usersConfig.optional).toBe(true)
    expect(usersWithLoginConfig.optional).toBe(true)
    expect(usersBasicConfig.optional).toBe(false)
  })

  test('counts 24h and 7d in one pass without distinct counts', () => {
    const sql = versions(usersConfig.sql)[1].sql
    expect(sql.match(/merge\('system', '\^query_log'\)/g)).toHaveLength(1)
    expect(sql).not.toMatch(/uniq/)
  })

  const on = { features: {} }
  const off = { features: { queries: { enabled: false } } } as never
  const tables = { queryLog: true, sessionLog: true }

  test('activity needs both the query log and the queries feature', () => {
    expect(resolveUsersVariant(tables, on).activity).toBe(true)
    expect(resolveUsersVariant(tables, off).activity).toBe(false)
    expect(
      resolveUsersVariant({ ...tables, queryLog: false }, on).activity
    ).toBe(false)
  })

  test('with queries disabled the page gets the accounts-only list', () => {
    expect(pickUsersConfig(resolveUsersVariant(tables, off))).toBe(
      usersBasicConfig
    )
  })
})

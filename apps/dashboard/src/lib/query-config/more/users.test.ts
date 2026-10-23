import type { VersionedSql } from '@/types/query-config'

import {
  pickUsersConfig,
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
  })

  test('every variant is registered by name', () => {
    for (const config of VARIANTS) {
      expect(getQueryConfigByName(config.name)?.name).toBe(config.name)
    }
  })
})

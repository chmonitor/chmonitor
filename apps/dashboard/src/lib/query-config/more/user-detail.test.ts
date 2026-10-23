import type { VersionedSql } from '@/types/query-config'

import {
  userDetailConfigs,
  userDetailHourlyConfig,
  userDetailLoginConfig,
  userDetailRecentConfig,
  userDetailSummaryConfig,
} from './user-detail'
import { describe, expect, test } from 'bun:test'

function sqlOf(config: { sql: unknown }): string {
  return typeof config.sql === 'string'
    ? config.sql
    : (config.sql as VersionedSql[]).map((v) => v.sql).join('\n')
}

describe('user-detail configs', () => {
  test('every fetch reads only the opened user', () => {
    for (const config of userDetailConfigs) {
      expect(sqlOf(config)).toContain('user = {user:String}')
      expect(config.defaultParams).toEqual({ user: '' })
    }
  })

  test('every scan is bounded on event_date for partition pruning', () => {
    for (const config of userDetailConfigs) {
      expect(sqlOf(config)).toMatch(
        /event_date >= (today\(\) - \d+|yesterday\(\))/
      )
    }
  })

  test('summary and recent are both bounded on event_time', () => {
    for (const config of [userDetailSummaryConfig, userDetailRecentConfig]) {
      expect(sqlOf(config)).toContain('event_time >= now() - INTERVAL 7 DAY')
    }
  })

  test('raw query text never reaches the output', () => {
    for (const config of userDetailConfigs) {
      expect(config.columns).not.toContain('query')
    }
    const sql = sqlOf(userDetailRecentConfig)
    const outer = sql
      .slice(0, sql.indexOf('FROM'))
      .replace('normalizeQuery(recent.query)', '')
    expect(outer).not.toMatch(/\bquery\b(?!_)/)
  })

  test('permissions follow the table each config reads', () => {
    for (const config of [
      userDetailSummaryConfig,
      userDetailRecentConfig,
      userDetailHourlyConfig,
    ]) {
      expect(config.permission).toEqual({ feature: 'queries' })
    }
    expect(userDetailLoginConfig.permission).toEqual({ feature: 'security' })
  })
})

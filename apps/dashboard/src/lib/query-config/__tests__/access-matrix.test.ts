/**
 * Access matrix query configs (#4123). The page runs these against customer
 * clusters, so they must stay read-only, optional (a missing table or SHOW
 * privilege degrades one section), and avoid columns old servers lack.
 */

import { getQueryConfigByName } from '../index'
import { accessMatrixConfigs } from '../security/access-matrix'
import { describe, expect, test } from 'bun:test'

const sqlOf = (sql: unknown): string =>
  typeof sql === 'string'
    ? sql
    : (sql as { sql: string }[]).map((v) => v.sql).join('\n')

describe('access matrix configs', () => {
  for (const config of accessMatrixConfigs) {
    describe(config.name, () => {
      const sql = sqlOf(config.sql)

      test('is registered', () => {
        expect(getQueryConfigByName(config.name)?.name).toBe(config.name)
      })

      test('is a read-only SELECT on its own system table', () => {
        expect(sql.trim()).toMatch(/^SELECT\b/)
        expect(sql).not.toMatch(
          /\b(GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|SET)\s/
        )
        expect(sql).not.toMatch(/SELECT \*/)
        expect(sql).toContain(`FROM ${config.tableCheck}`)
      })

      test('degrades instead of failing the page', () => {
        expect(config.optional).toBe(true)
      })

      test('selects every declared column', () => {
        for (const column of config.columns) expect(sql).toContain(column)
      })
    })
  }

  test('grants avoids access_object, which only recent servers have', () => {
    const grants = accessMatrixConfigs.find((c) => c.name === 'access-grants')
    expect(sqlOf(grants?.sql)).not.toContain('access_object')
  })

  test('profile elements keep readonly and inherited profiles, the inputs of the readonly cap', () => {
    const el = accessMatrixConfigs.find(
      (c) => c.name === 'access-profile-elements'
    )
    const sql = sqlOf(el?.sql)
    expect(sql).toContain("setting_name = 'readonly'")
    expect(sql).toContain('inherit_profile IS NOT NULL')
  })

  test('table expansion is bounded and parameterised', () => {
    const tables = accessMatrixConfigs.find((c) => c.name === 'access-tables')
    const sql = sqlOf(tables?.sql)
    expect(sql).toContain('{database:String}')
    expect(sql).toMatch(/LIMIT 500\s*$/)
  })
})

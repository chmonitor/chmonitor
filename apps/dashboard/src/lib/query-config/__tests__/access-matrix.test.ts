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

      // Without it CHM_DISABLED_FEATURES=security hides the page while the
      // grants of every user keep flowing through /api/v1/data.
      test('is gated on the security feature', () => {
        expect(config.permission).toEqual({ feature: 'security' })
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

  // Before 26.7 a `d1.t*` grant reads as table `t`; is_wildcard is the only
  // column that tells the two apart, and it does not exist on older servers.
  test('grants reads is_wildcard from 26.7 and a 0 placeholder before', () => {
    const grants = accessMatrixConfigs.find((c) => c.name === 'access-grants')
    const versions = grants?.sql as { since: string; sql: string }[]
    expect(versions.map((v) => v.since)).toEqual(['23.8', '26.7'])
    expect(versions[0].sql).toContain('toUInt8(0) AS is_wildcard')
    expect(versions[1].sql).toMatch(/grant_option,\s+is_wildcard\s+FROM/)
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

  describe('replica drift reads', () => {
    const replicaConfigs = accessMatrixConfigs.filter((c) =>
      /^access-replica/.test(c.name)
    )

    test('every replica read fans out with a cluster parameter, skipping dead replicas', () => {
      expect(replicaConfigs.map((c) => c.name)).toEqual([
        'access-replica-grants',
        'access-replica-role-grants',
        'access-replicas',
      ])
      for (const c of replicaConfigs) {
        const sql = sqlOf(c.sql)
        expect(sql).toContain('clusterAllReplicas(')
        expect(sql).toContain('{cluster:String}')
        expect(sql).toContain('hostName() AS replica')
        expect(sql).toContain('skip_unavailable_shards = 1')
        expect(c.defaultParams).toEqual({ cluster: '' })
      }
    })

    test('replica grants keep the is_wildcard version split', () => {
      const grants = accessMatrixConfigs.find(
        (c) => c.name === 'access-replica-grants'
      )
      const versions = grants?.sql as { since: string; sql: string }[]
      expect(versions.map((v) => v.since)).toEqual(['23.8', '26.7'])
      expect(versions[0].sql).toContain('toUInt8(0) AS is_wildcard')
    })
  })
})

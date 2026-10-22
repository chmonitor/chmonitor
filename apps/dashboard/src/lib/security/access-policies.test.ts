/**
 * Row policies and quotas in the Access matrix sheets (#4123). The fixtures
 * are real rows, and each expectation matches what that server did: alice
 * read every row of db1.t and bob read none, so the sheet must list the
 * policies that actually filtered each of them.
 */

import type { Grantee } from './access-matrix'

import {
  quotaLimits,
  quotas,
  quotasUsage,
  roleGrants,
  rowPolicies,
} from './__fixtures__/access-policy-rows'
import { granteeAccess } from './access-matrix'
import {
  appliesTo,
  formatDuration,
  limitedMetrics,
  policiesForCell,
  quotasForGrantee,
} from './access-policies'
import { describe, expect, test } from 'bun:test'

const access = (grantee: Grantee) =>
  granteeAccess(grantee, {
    grants: [],
    roleGrants,
    profiles: [],
    profileElements: [],
  })
const alice = access({ kind: 'user', name: 'alice' })
const bob = access({ kind: 'user', name: 'bob' })
const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort()

describe('apply-to matching', () => {
  test('a role in EXCEPT excludes a user that has it active', () => {
    expect(
      appliesTo(
        { apply_to_all: 1, apply_to_list: [], apply_to_except: ['r'] },
        ['u', 'r']
      )
    ).toBe(false)
  })

  test('a role in the list includes a user that has it active', () => {
    expect(
      appliesTo(
        { apply_to_all: 0, apply_to_list: ['r'], apply_to_except: [] },
        ['u', 'r']
      )
    ).toBe(true)
  })
})

describe('row policies in the cell sheet', () => {
  test('alice on db1.t: the db1.* policy and her default role policy, not p_ex', () => {
    const p = policiesForCell(alice, rowPolicies, {
      database: 'db1',
      table: 't',
    })
    expect(names(p.applied)).toEqual(['p_all', 'p_tenant'])
    const tenant = p.applied.find((x) => x.name === 'p_tenant')
    expect(tenant).toMatchObject({
      condition: "tenant = 'a'",
      kind: 'permissive',
      table: 't',
      narrower: false,
    })
  })

  test('a policy through a non-default role is only listed after SET ROLE', () => {
    const p = policiesForCell(alice, rowPolicies, {
      database: 'db1',
      table: 't',
    })
    expect(names(p.viaSetRole)).toEqual(['p_off'])
    expect(p.viaSetRole[0]?.kind).toBe('restrictive')
  })

  test('bob on db1.t: his own policy and the ALL EXCEPT r_tenant one, not p_all', () => {
    const p = policiesForCell(bob, rowPolicies, { database: 'db1', table: 't' })
    expect(names(p.applied)).toEqual(['p_bob', 'p_ex'])
    expect(p.applied.every((x) => x.kind === 'restrictive')).toBe(true)
  })

  test('a whole-database cell marks table policies as narrower', () => {
    const p = policiesForCell(alice, rowPolicies, { database: 'db1' })
    expect(p.applied.find((x) => x.name === 'p_all')).toMatchObject({
      table: null,
      narrower: false,
    })
    expect(p.applied.find((x) => x.name === 'p_tenant')?.narrower).toBe(true)
  })

  test('another database has no policies', () => {
    const p = policiesForCell(alice, rowPolicies, { database: 'default' })
    expect(p.applied).toEqual([])
    expect(p.viaSetRole).toEqual([])
  })

  test('a role sees the policies granted to it', () => {
    const role = access({ kind: 'role', name: 'r_tenant' })
    const p = policiesForCell(role, rowPolicies, {
      database: 'db1',
      table: 't',
    })
    expect(names(p.applied)).toEqual(['p_all', 'p_tenant'])
  })
})

describe('quotas in the grantee sheet', () => {
  test('alice has her own quota and the one through r_tenant', () => {
    const q = quotasForGrantee(alice, quotas, quotaLimits, quotasUsage)
    expect(names(q)).toEqual(['q_alice', 'q_role'])
  })

  test('an unkeyed quota shows the shared usage of each interval', () => {
    const q = quotasForGrantee(alice, quotas, quotaLimits, quotasUsage)
    const own = q.find((x) => x.name === 'q_alice')
    expect(own?.usageKey).toBe('shared')
    expect(own?.limits.map((l) => l.duration)).toEqual([3600, 86400])
    expect(own?.usage.map((u) => [u.duration, u.queries])).toEqual([
      [3600, 3],
      [86400, 3],
    ])
    expect(limitedMetrics(own?.limits ?? [])).toEqual([
      'queries',
      'errors',
      'read_rows',
    ])
  })

  test('a user-keyed quota with no usage row has no usage, not another key', () => {
    const q = quotasForGrantee(alice, quotas, quotaLimits, quotasUsage)
    const role = q.find((x) => x.name === 'q_role')
    expect(role?.usageKey).toBe('user')
    expect(role?.usage).toEqual([])
  })

  test('a user-keyed quota shows only the row keyed by this user', () => {
    // On an earlier run of the same server alice consumed q_role instead
    // (quota_key 'alice'); ClickHouse picks one of the applying quotas.
    const row = (key: string, queries: number) => ({
      quota_name: 'q_role',
      quota_key: key,
      is_current: 0,
      end_time: '2026-10-23 03:00:00',
      duration: 1800,
      queries,
    })
    const q = quotasForGrantee(alice, quotas, quotaLimits, [
      row('alice', 4),
      row('bob', 9),
      row('', 1),
    ])
    expect(
      q.find((x) => x.name === 'q_role')?.usage.map((u) => u.queries)
    ).toEqual([4])
  })

  test('the default quota of user default is not shown for alice or bob', () => {
    expect(quotasForGrantee(bob, quotas, quotaLimits, quotasUsage)).toEqual([])
  })

  test('a role lists its quota and limits but no usage', () => {
    const role = access({ kind: 'role', name: 'r_tenant' })
    const q = quotasForGrantee(role, quotas, quotaLimits, quotasUsage)
    expect(names(q)).toEqual(['q_role'])
    expect(q[0]?.limits[0]?.max_execution_time).toBe(60)
    expect(q[0]?.usage).toEqual([])
  })

  test.each([
    [3600, '1h'],
    [86400, '1d'],
    [1800, '30m'],
    [45, '45s'],
    ['3600', '1h'],
    [null, '—'],
  ])('formatDuration(%p) is %p', (input, out) => {
    expect(formatDuration(input)).toBe(out)
  })
})

/**
 * Replica drift (#4123). The point of the check is that a rollout which
 * reached some replicas shows up as a differing cell, and that a replica
 * which did not answer is reported as skipped instead of as "no grants".
 */

import type {
  ClusterMemberRow,
  ReplicaGrantRow,
  ReplicaRoleGrantRow,
} from './access-drift'

import {
  buildReplicaView,
  cellDrift,
  granteeDriftDatabases,
  pickDriftCluster,
  skippedReplicas,
} from './access-drift'
import { describe, expect, test } from 'bun:test'

const grant = (
  replica: string,
  p: Partial<ReplicaGrantRow>
): ReplicaGrantRow => ({
  replica,
  user_name: null,
  role_name: null,
  access_type: 'SELECT',
  database: 'sales',
  table: null,
  column: null,
  is_partial_revoke: 0,
  grant_option: 0,
  ...p,
})

const member = (
  host: string,
  p: Partial<ClusterMemberRow> = {}
): ClusterMemberRow => ({
  cluster: 'c',
  host_name: host,
  host_address: `ip-${host}`,
  port: 9000,
  is_local: 0,
  ...p,
})

const users = [{ name: 'alice', storage: 'local_directory' }]
const base = {
  kind: 'user' as const,
  grantees: users,
  databases: ['sales', 'ops'],
  roleGrants: [] as ReplicaRoleGrantRow[],
  shared: { profiles: [], profileElements: [] },
}

describe('buildReplicaView / cellDrift', () => {
  test('flags a cell whose effective access differs and lists each replica', () => {
    const view = buildReplicaView({
      ...base,
      grants: [
        grant('r1', { user_name: 'alice', access_type: 'INSERT' }),
        grant('r2', { user_name: 'alice', access_type: 'SELECT' }),
      ],
      responded: ['r1', 'r2'],
      members: [member('r1'), member('r2')],
    })
    const drift = cellDrift(view, 'alice', { database: 'sales' })
    expect(drift.drifted).toBe(true)
    expect(drift.replicas.map((r) => [r.replica, r.cell.level])).toEqual([
      ['r1', 'write'],
      ['r2', 'read'],
    ])
    expect(granteeDriftDatabases(view, 'alice', base.databases)).toEqual([
      'sales',
    ])
  })

  test('identical grants on every replica are not drift', () => {
    const view = buildReplicaView({
      ...base,
      grants: [
        grant('r1', { user_name: 'alice' }),
        grant('r2', { user_name: 'alice' }),
      ],
      responded: ['r1', 'r2'],
      members: [member('r1'), member('r2')],
    })
    expect(cellDrift(view, 'alice', { database: 'sales' }).drifted).toBe(false)
    expect(granteeDriftDatabases(view, 'alice', base.databases)).toEqual([])
  })

  // The same effective access reached through a different path is not drift.
  test('a direct grant on one replica and the same grant through a role on another agree', () => {
    const view = buildReplicaView({
      ...base,
      grants: [
        grant('r1', { user_name: 'alice' }),
        grant('r2', { role_name: 'analyst' }),
      ],
      roleGrants: [
        {
          replica: 'r2',
          user_name: 'alice',
          role_name: null,
          granted_role_name: 'analyst',
          granted_role_is_default: 1,
        },
      ],
      responded: ['r1', 'r2'],
      members: [member('r1'), member('r2')],
    })
    expect(cellDrift(view, 'alice', { database: 'sales' }).drifted).toBe(false)
  })

  // Fails on a naive diff that treats a missing replica as "no grants".
  test('a replica that did not answer is skipped, not drift', () => {
    const view = buildReplicaView({
      ...base,
      grants: [
        grant('r1', { user_name: 'alice' }),
        grant('r2', { user_name: 'alice' }),
      ],
      responded: ['r1', 'r2'],
      members: [member('r1'), member('r2'), member('r3')],
    })
    expect(view.skipped).toEqual(['r3:9000'])
    expect(view.comparable).toBe(true)
    expect(cellDrift(view, 'alice', { database: 'sales' }).drifted).toBe(false)
  })

  test('a replica that answered with no grants is compared, as no access', () => {
    const view = buildReplicaView({
      ...base,
      grants: [grant('r1', { user_name: 'alice' })],
      responded: ['r1', 'r2'],
      members: [member('r1'), member('r2')],
    })
    expect(view.skipped).toEqual([])
    expect(cellDrift(view, 'alice', { database: 'sales' }).drifted).toBe(true)
  })

  test('with one answering replica nothing is comparable', () => {
    const view = buildReplicaView({
      ...base,
      grants: [grant('r1', { user_name: 'alice' })],
      responded: ['r1'],
      members: [member('r1'), member('r2')],
    })
    expect(view.comparable).toBe(false)
    expect(cellDrift(view, 'alice', { database: 'sales' }).drifted).toBe(false)
    expect(granteeDriftDatabases(view, 'alice', base.databases)).toEqual([])
  })

  test('a readonly profile caps every replica the same way', () => {
    const view = buildReplicaView({
      ...base,
      grants: [
        grant('r1', { user_name: 'alice', access_type: 'INSERT' }),
        grant('r2', { user_name: 'alice', access_type: 'SELECT' }),
      ],
      responded: ['r1', 'r2'],
      members: [member('r1'), member('r2')],
      shared: {
        profiles: [
          {
            name: 'ro',
            apply_to_all: 0,
            apply_to_list: ['alice'],
            apply_to_except: [],
          },
        ],
        profileElements: [
          {
            profile_name: 'ro',
            user_name: null,
            role_name: null,
            setting_name: 'readonly',
            value: '1',
            inherit_profile: null,
          },
        ],
      },
    })
    // INSERT is capped to read, so both replicas end at read: no drift.
    expect(cellDrift(view, 'alice', { database: 'sales' }).drifted).toBe(false)
  })
})

describe('skippedReplicas', () => {
  test('matches by host name or address, and never skips the local member', () => {
    const members = [
      member('a'),
      member('b'),
      member('localhost', { is_local: 1 }),
    ]
    expect(skippedReplicas(members, ['A', 'ip-b'])).toEqual([])
    expect(skippedReplicas(members, ['a'])).toEqual(['b:9000'])
  })
})

describe('pickDriftCluster', () => {
  test('no cluster gives a reason', () => {
    const r = pickDriftCluster([])
    expect(r.cluster).toBeNull()
    expect(r.reason).toContain('no cluster')
  })

  test('a single-replica cluster gives a reason', () => {
    const r = pickDriftCluster([member('a')])
    expect(r.cluster).toBeNull()
    expect(r.reason).toContain('single replica')
  })

  test('picks the widest cluster and lists its members once', () => {
    const r = pickDriftCluster([
      member('a'),
      member('b'),
      member('b'),
      member('x', { cluster: 'small' }),
    ])
    expect(r.cluster).toBe('c')
    expect(r.members.map((m) => m.host_name)).toEqual(['a', 'b'])
  })
})

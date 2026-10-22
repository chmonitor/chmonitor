/**
 * Effective access (#4123). The fixtures are real system.* rows, so these
 * tests pin the rules the matrix promises an admin: nested roles are
 * followed and attributed, partial revokes are per grantee, and a readonly
 * profile caps a write grant at read.
 */

import type {
  AccessInputs,
  Grantee,
  GrantRow,
  RoleGrantRow,
} from './access-matrix'

import {
  grants,
  profileElements,
  profiles,
  roleGrants,
} from './__fixtures__/access-matrix-rows'
import {
  computeCell,
  granteeAccess,
  privilegeLevel,
  roleClosure,
  roleMembers,
  summarizeCell,
} from './access-matrix'
import { describe, expect, test } from 'bun:test'

const inputs: AccessInputs = { grants, roleGrants, profiles, profileElements }

const user = (name: string): Grantee => ({ kind: 'user', name })
const cell = (
  g: Grantee,
  database: string,
  table?: string,
  i: AccessInputs = inputs
) => {
  const a = granteeAccess(g, i)
  return computeCell(a.sourced, { database, table }, a.readonly)
}

describe('role closure', () => {
  test('follows a role granted to a role and keeps the path', () => {
    expect(roleClosure(user('analyst'), roleGrants)).toEqual([
      { role: 'r_a', path: ['analyst', 'r_a'], isDefault: true },
      { role: 'r_b', path: ['analyst', 'r_a', 'r_b'], isDefault: true },
    ])
  })

  test('stops on a cycle instead of looping', () => {
    const cyclic: RoleGrantRow[] = [
      {
        user_name: 'u',
        role_name: null,
        granted_role_name: 'x',
        granted_role_is_default: 1,
      },
      {
        user_name: null,
        role_name: 'x',
        granted_role_name: 'y',
        granted_role_is_default: 1,
      },
      {
        user_name: null,
        role_name: 'y',
        granted_role_name: 'x',
        granted_role_is_default: 1,
      },
    ]
    expect(roleClosure(user('u'), cyclic).map((r) => r.role)).toEqual([
      'x',
      'y',
    ])
  })

  test('lists who holds a role', () => {
    expect(roleMembers('r_b', roleGrants)).toEqual([
      { kind: 'role', name: 'r_a', isDefault: true },
    ])
  })
})

describe('nested-role access', () => {
  test('analyst reads every database through analyst ← r_a ← r_b', () => {
    const c = cell(user('analyst'), 'other')
    expect(c.level).toBe('read')
    expect(c.viaRole).toBe(true)
    expect(c.direct).toBe(false)
    expect(c.privileges[0].source).toEqual(['analyst', 'r_a', 'r_b'])
  })

  test('a user with no grants and no roles has none', () => {
    expect(cell(user('nobody'), 'db').level).toBe('none')
  })
})

describe('partial revokes', () => {
  test('a table revoke marks the database cell and removes the table cell', () => {
    const dbCell = cell(user('analyst'), 'db')
    expect(dbCell.level).toBe('read')
    expect(dbCell.partialRevoke).toBe(true)
    expect(dbCell.revokes.map((r) => `${r.accessType} ${r.table}`)).toEqual([
      'SELECT secret',
    ])
    expect(cell(user('analyst'), 'db', 'secret').level).toBe('none')
    expect(cell(user('analyst'), 'db', 't').level).toBe('read')
  })

  test('REVOKE INSERT carved out of ALL leaves db.secret readable but not insertable', () => {
    const secret = cell(user('admin2'), 'db', 'secret')
    expect(secret.privileges.map((p) => p.accessType)).not.toContain('INSERT')
    expect(secret.privileges.map((p) => p.accessType)).toContain('SELECT')
    expect(cell(user('admin2'), 'db').partialRevoke).toBe(true)
  })

  test("a user's own REVOKE does not remove a privilege that comes from a role", () => {
    const withUserRevoke: AccessInputs = {
      ...inputs,
      grants: [
        ...grants,
        {
          user_name: 'analyst',
          role_name: null,
          access_type: 'SELECT',
          database: 'other',
          table: null,
          column: null,
          is_partial_revoke: 1,
          grant_option: 0,
        } satisfies GrantRow,
      ],
    }
    expect(
      cell(user('analyst'), 'other', undefined, withUserRevoke).level
    ).toBe('read')
  })
})

describe('readonly cap', () => {
  test('INSERT plus a readonly = 2 profile is read only, with the reason', () => {
    const c = cell(user('writer'), 'db')
    expect(c.grantedLevel).toBe('write')
    expect(c.level).toBe('read')
    expect(c.readonly?.value).toBe('2')
    expect(summarizeCell(c)).toBe(
      'read only: INSERT is granted directly, but profile ro sets readonly = 2.'
    )
  })

  test('readonly is inherited through a profile chain', () => {
    const viaChild: AccessInputs = {
      ...inputs,
      profileElements: [
        ...profileElements,
        {
          profile_name: null,
          user_name: 'admin2',
          role_name: null,
          setting_name: null,
          value: null,
          inherit_profile: 'ro_child',
        },
      ],
    }
    const c = cell(user('admin2'), 'db', undefined, viaChild)
    expect(c.level).toBe('read')
    expect(c.readonly?.reason).toBe('profile ro_child sets readonly = 2')
  })

  test('without a readonly profile, write stays write', () => {
    expect(cell(user('admin2'), 'db').readonly).toBeNull()
  })
})

describe('privilege levels', () => {
  test.each([
    ['SELECT', 'read'],
    ['dictGet', 'read'],
    ['INSERT', 'write'],
    ['ALTER UPDATE', 'write'],
    ['CREATE TABLE', 'admin'],
    ['DROP TABLE', 'admin'],
    ['CHECK', 'none'],
  ] as const)('%s is %s', (type, level) => {
    expect(privilegeLevel(type)).toBe(level)
  })

  test('grant option makes a data privilege admin, not a global one', () => {
    expect(privilegeLevel('SELECT', true)).toBe('admin')
    expect(privilegeLevel('SHOW USERS', true)).toBe('none')
  })

  // These are granted ON *.* to ordinary users (the monitoring user needs the
  // SHOW set), so classifying them as data access would light up every
  // database for everyone.
  test.each([
    ['SHOW USERS'],
    ['SHOW ROLES'],
    ['SHOW ROW POLICIES'],
    ['SHOW QUOTAS'],
    ['SHOW SETTINGS PROFILES'],
    ['CREATE TEMPORARY TABLE'],
    ['ALTER USER'],
    ['ALTER ROW POLICY'],
    ['SYSTEM FLUSH LOGS'],
  ])('global %s ON *.* gives none on a database', (type) => {
    const global: AccessInputs = {
      grants: [
        {
          user_name: 'monitor',
          role_name: null,
          access_type: type,
          database: null,
          table: null,
          column: null,
          is_partial_revoke: 0,
          grant_option: 0,
        },
      ],
      roleGrants: [],
      profiles: [],
      profileElements: [],
    }
    expect(cell(user('monitor'), 'db', undefined, global).level).toBe('none')
  })

  test('ALL on a database is admin', () => {
    expect(cell(user('admin2'), 'db').level).toBe('admin')
    expect(cell(user('admin2'), 'other').level).toBe('none')
  })
})

const grant = (over: Partial<GrantRow>): GrantRow => ({
  user_name: null,
  role_name: null,
  access_type: 'SELECT',
  database: null,
  table: null,
  column: null,
  is_partial_revoke: 0,
  grant_option: 0,
  ...over,
})

const only = (grantRows: GrantRow[], roleGrantRows: RoleGrantRow[] = []) => ({
  grants: grantRows,
  roleGrants: roleGrantRows,
  profiles: [],
  profileElements: [],
})

// Rows as 26.9 returns them for `GRANT SELECT ON d1.t* TO u13`,
// `GRANT SELECT ON d*.* TO u14` and `REVOKE SELECT ON d1.t* FROM u14`.
describe('wildcard grants (is_wildcard, 26.7+)', () => {
  const u13 = only([
    grant({ user_name: 'u13', database: 'd1', table: 't', is_wildcard: 1 }),
  ])

  test('d1.t* reads every table with the prefix, not only `t`', () => {
    expect(cell(user('u13'), 'd1', 't1', u13).level).toBe('read')
    expect(cell(user('u13'), 'd1', 'tx', u13).level).toBe('read')
    expect(cell(user('u13'), 'd1', 'other', u13).level).toBe('none')
  })

  test('d1.t* is narrower than the whole of d1', () => {
    const db = cell(user('u13'), 'd1', undefined, u13)
    expect(db.level).toBe('none')
    expect(db.narrowerGrants).toBe(true)
  })

  test('d*.* covers every database with the prefix', () => {
    const u14 = only([
      grant({ user_name: 'u14', database: 'd', is_wildcard: 1 }),
    ])
    expect(cell(user('u14'), 'd1', undefined, u14).level).toBe('read')
    expect(cell(user('u14'), 'other', undefined, u14).level).toBe('none')
  })

  test('a wildcard revoke carves out every table with the prefix', () => {
    const u14 = only([
      grant({ user_name: 'u14', database: 'd', is_wildcard: 1 }),
      grant({
        user_name: 'u14',
        database: 'd1',
        table: 't',
        is_partial_revoke: 1,
        is_wildcard: 1,
      }),
    ])
    expect(cell(user('u14'), 'd1', 'tb', u14).level).toBe('none')
    expect(cell(user('u14'), 'd1', 'other', u14).level).toBe('read')
    expect(cell(user('u14'), 'd1', undefined, u14).partialRevoke).toBe(true)
  })

  test('without is_wildcard (before 26.7) the row is the exact table', () => {
    const old = only([grant({ user_name: 'u13', database: 'd1', table: 't' })])
    expect(cell(user('u13'), 'd1', 't1', old).level).toBe('none')
    expect(cell(user('u13'), 'd1', 't', old).level).toBe('read')
  })
})

// Rows as 26.9 returns them for `GRANT r5 TO u5; SET DEFAULT ROLE NONE TO u5`.
describe('non-default roles', () => {
  const u5 = only(
    [
      grant({ role_name: 'r5', database: 'd1' }),
      grant({ role_name: 'r5b', access_type: 'INSERT', database: 'd1' }),
    ],
    [
      {
        user_name: 'u5',
        role_name: null,
        granted_role_name: 'r5',
        granted_role_is_default: 0,
      },
      {
        user_name: null,
        role_name: 'r5',
        granted_role_name: 'r5b',
        granted_role_is_default: 1,
      },
    ]
  )

  test('a grant only through a non-default role does not count', () => {
    const c = cell(user('u5'), 'd1', undefined, u5)
    expect(c.level).toBe('none')
    expect(c.privileges).toEqual([])
    expect(c.setRoleLevel).toBe('write')
    expect(c.availableViaSetRole.map((p) => p.source)).toEqual([
      ['u5', 'r5'],
      ['u5', 'r5', 'r5b'],
    ])
    expect(summarizeCell(c)).toBe(
      'no access. write is available via SET ROLE of a non-default role.'
    )
  })

  test('the role itself has the access (roles of a role are always active)', () => {
    const c = cell({ kind: 'role', name: 'r5' }, 'd1', undefined, u5)
    expect(c.level).toBe('write')
    expect(c.availableViaSetRole).toEqual([])
  })

  test('a role also reachable through a default role counts', () => {
    // u → x (non-default) → shared, u → y (default) → z → shared: the
    // non-default path is shorter, but the default one makes shared active.
    const diamond = only(
      [grant({ role_name: 'shared', database: 'd1' })],
      [
        {
          user_name: 'u',
          role_name: null,
          granted_role_name: 'x',
          granted_role_is_default: 0,
        },
        {
          user_name: 'u',
          role_name: null,
          granted_role_name: 'y',
          granted_role_is_default: 1,
        },
        {
          user_name: null,
          role_name: 'x',
          granted_role_name: 'shared',
          granted_role_is_default: 1,
        },
        {
          user_name: null,
          role_name: 'y',
          granted_role_name: 'z',
          granted_role_is_default: 1,
        },
        {
          user_name: null,
          role_name: 'z',
          granted_role_name: 'shared',
          granted_role_is_default: 1,
        },
      ]
    )
    expect(cell(user('u'), 'd1', undefined, diamond).level).toBe('read')
  })

  test('a readonly profile on a non-default role does not cap the cell', () => {
    const i: AccessInputs = {
      ...only(
        [grant({ user_name: 'u', access_type: 'INSERT', database: 'd1' })],
        [
          {
            user_name: 'u',
            role_name: null,
            granted_role_name: 'ro_role',
            granted_role_is_default: 0,
          },
        ]
      ),
      profileElements: [
        {
          profile_name: null,
          user_name: null,
          role_name: 'ro_role',
          setting_name: 'readonly',
          value: '1',
          inherit_profile: null,
        },
      ],
    }
    expect(cell(user('u'), 'd1', undefined, i).level).toBe('write')
  })

  // 26.9: `CREATE SETTINGS PROFILE p SETTINGS readonly=1 TO ALL EXCEPT r_ro`
  // gives getSetting('readonly') = 0 to a user whose default role is r_ro,
  // and 1 to a user without it.
  test('a profile TO ALL EXCEPT a default role does not cap its holders', () => {
    const i: AccessInputs = {
      ...only(
        [
          grant({ user_name: 'u', access_type: 'INSERT', database: 'd1' }),
          grant({ user_name: 'v', access_type: 'INSERT', database: 'd1' }),
        ],
        [
          {
            user_name: 'u',
            role_name: null,
            granted_role_name: 'r_ro',
            granted_role_is_default: 1,
          },
        ]
      ),
      profiles: [
        {
          name: 'p',
          apply_to_all: 1,
          apply_to_list: [],
          apply_to_except: ['r_ro'],
        },
      ],
      profileElements: [
        {
          profile_name: 'p',
          user_name: null,
          role_name: null,
          setting_name: 'readonly',
          value: '1',
          inherit_profile: null,
        },
      ],
    }
    expect(cell(user('u'), 'd1', undefined, i).level).toBe('write')
    expect(cell(user('v'), 'd1', undefined, i).readonly?.value).toBe('1')
  })
})

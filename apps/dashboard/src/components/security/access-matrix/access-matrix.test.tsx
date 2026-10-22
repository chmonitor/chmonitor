/**
 * Access matrix UI (#4123): the cell chip must show the capped level with
 * its markers, and the cell sheet must say WHY (role path, readonly reason),
 * since that is the answer an admin opens it for.
 */
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
afterEach(() => document.body.replaceChildren())

async function setup(user: string, database: string) {
  const { computeCell, granteeAccess } = await import(
    '@/lib/security/access-matrix'
  )
  const fx = await import('@/lib/security/__fixtures__/access-matrix-rows')
  const access = granteeAccess(
    { kind: 'user', name: user },
    {
      grants: fx.grants,
      roleGrants: fx.roleGrants,
      profiles: fx.profiles,
      profileElements: fx.profileElements,
    }
  )
  const cell = computeCell(access.sourced, { database }, access.readonly)
  return { access, cell }
}

async function render(element: unknown) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(element as never)
  })
  return container
}

test('a readonly writer shows read with the readonly marker', async () => {
  const { createElement } = await import('react')
  const { AccessChip } = await import('./access-chip')
  const { cell } = await setup('writer', 'db')
  const el = await render(createElement(AccessChip, { cell }))
  expect(el.textContent).toBe('read')
  expect(el.querySelector('[aria-label="readonly = 2"]')).not.toBeNull()
})

test('a nested-role grant with a revoke shows role and revoke markers', async () => {
  const { createElement } = await import('react')
  const { AccessChip } = await import('./access-chip')
  const { cell } = await setup('analyst', 'db')
  const el = await render(createElement(AccessChip, { cell }))
  expect(el.querySelector('[aria-label="through a role"]')).not.toBeNull()
  expect(el.querySelector('[aria-label="partial revoke"]')).not.toBeNull()
})

// CellDetail is the sheet body, rendered without the portal so the test
// does not depend on whether Base UI saw a DOM when it was first imported.
test('the cell detail names the role path and the carved-out table', async () => {
  const { createElement } = await import('react')
  const { CellDetail } = await import('./access-sheets')
  const { cell } = await setup('analyst', 'db')
  const el = await render(createElement(CellDetail, { cell }))
  expect(el.textContent).toContain('analyst ← r_a ← r_b')
  expect(el.textContent).toContain('Carved out (partial revokes)')
  expect(el.textContent).toContain('db.secret')
})

test('the cell detail explains the readonly cap', async () => {
  const { createElement } = await import('react')
  const { CellDetail } = await import('./access-sheets')
  const { cell } = await setup('writer', 'db')
  const el = await render(createElement(CellDetail, { cell }))
  expect(el.textContent).toContain(
    'Granted level is write, but profile ro sets readonly = 2, so writes are refused.'
  )
})

const setRoleCell = async () => {
  const { computeCell, granteeAccess } = await import(
    '@/lib/security/access-matrix'
  )
  const access = granteeAccess(
    { kind: 'user', name: 'u5' },
    {
      grants: [
        {
          user_name: null,
          role_name: 'r5',
          access_type: 'SELECT',
          database: 'd1',
          table: null,
          column: null,
          is_partial_revoke: 0,
          grant_option: 0,
        },
      ],
      roleGrants: [
        {
          user_name: 'u5',
          role_name: null,
          granted_role_name: 'r5',
          granted_role_is_default: 0,
        },
      ],
      profiles: [],
      profileElements: [],
    }
  )
  return computeCell(access.sourced, { database: 'd1' }, access.readonly)
}

test('a non-default role shows none with the SET ROLE marker', async () => {
  const { createElement } = await import('react')
  const { AccessChip } = await import('./access-chip')
  const el = await render(
    createElement(AccessChip, { cell: await setRoleCell() })
  )
  expect(el.textContent).toBe('none')
  expect(
    el.querySelector('[aria-label="read available via SET ROLE"]')
  ).not.toBeNull()
  expect(el.querySelector('[aria-label="through a role"]')).toBeNull()
})

test('the cell detail lists SET ROLE privileges apart from the counted ones', async () => {
  const { createElement } = await import('react')
  const { CellDetail } = await import('./access-sheets')
  const el = await render(
    createElement(CellDetail, { cell: await setRoleCell() })
  )
  expect(el.textContent).toContain('Available via SET ROLE (not counted)')
  expect(el.textContent).toContain('u5 ← r5')
})

test('a wildcard grant shows its prefix in the scope', async () => {
  const { createElement } = await import('react')
  const { CellDetail } = await import('./access-sheets')
  const { computeCell, granteeAccess } = await import(
    '@/lib/security/access-matrix'
  )
  const access = granteeAccess(
    { kind: 'user', name: 'u13' },
    {
      grants: [
        {
          user_name: 'u13',
          role_name: null,
          access_type: 'SELECT',
          database: 'd1',
          table: 't',
          column: null,
          is_partial_revoke: 0,
          grant_option: 0,
          is_wildcard: 1,
        },
      ],
      roleGrants: [],
      profiles: [],
      profileElements: [],
    }
  )
  const cell = computeCell(access.sourced, { database: 'd1' }, null)
  const el = await render(createElement(CellDetail, { cell }))
  expect(el.textContent).toContain('d1.t*')
})

test('the expanded table list says when it stops at the LIMIT', async () => {
  const { createElement } = await import('react')
  const { TablesCapNotice } = await import('./access-matrix-view')
  const { ACCESS_TABLES_LIMIT } = await import(
    '@/lib/query-config/security/access-matrix'
  )
  const capped = await render(
    createElement(TablesCapNotice, {
      database: 'big',
      count: ACCESS_TABLES_LIMIT,
    })
  )
  expect(capped.textContent).toContain('Only the first 500 tables of big')
  const under = await render(
    createElement(TablesCapNotice, { database: 'small', count: 3 })
  )
  expect(under.textContent).toBe('')
})

async function policyFixtures(grantee: {
  kind: 'user' | 'role'
  name: string
}) {
  const { granteeAccess } = await import('@/lib/security/access-matrix')
  const fx = await import('@/lib/security/__fixtures__/access-policy-rows')
  const access = granteeAccess(grantee, {
    grants: [],
    roleGrants: fx.roleGrants,
    profiles: [],
    profileElements: [],
  })
  return { access, fx }
}

test('the cell sheet lists each row policy with its condition and kind', async () => {
  const { createElement } = await import('react')
  const { CellDetail } = await import('./access-sheets')
  const { computeCell } = await import('@/lib/security/access-matrix')
  const { policiesForCell } = await import('@/lib/security/access-policies')
  const { access, fx } = await policyFixtures({ kind: 'user', name: 'alice' })
  const scope = { database: 'db1', table: 't' }
  const el = await render(
    createElement(CellDetail, {
      cell: computeCell(access.sourced, scope, access.readonly),
      policies: policiesForCell(access, fx.rowPolicies, scope),
    })
  )
  const text = el.textContent ?? ''
  expect(text).toContain("tenant = 'a'")
  expect(text).toContain('permissive')
  expect(text).toContain('Row policies after SET ROLE')
  expect(text).toContain('a > 10')
  expect(text).not.toContain('p_ex')
})

test('the grantee sheet lists quota limits, usage and the no-stacking note', async () => {
  const { createElement } = await import('react')
  const { QuotaList } = await import('./quota-list')
  const { quotasForGrantee } = await import('@/lib/security/access-policies')
  const { access, fx } = await policyFixtures({ kind: 'user', name: 'alice' })
  const el = await render(
    createElement(QuotaList, {
      quotas: quotasForGrantee(
        access,
        fx.quotas,
        fx.quotaLimits,
        fx.quotasUsage
      ),
      isUser: true,
    })
  )
  const text = el.textContent ?? ''
  expect(text).toContain('the limits do not add up')
  expect(text).toContain('usage is shared')
  const row = [...el.querySelectorAll('tr')].find((tr) =>
    tr.textContent?.startsWith('1hQueries')
  )
  expect(row?.textContent).toBe('1hQueries1003')
  expect(text).toContain('1d (randomized)')
})

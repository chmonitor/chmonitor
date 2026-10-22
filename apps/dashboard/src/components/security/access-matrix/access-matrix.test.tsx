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

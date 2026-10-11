/**
 * An empty audit log renders the shared EmptyState, not a bare paragraph.
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

test('renders EmptyState when there are no entries', async () => {
  localStorage.clear()
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AuditLogPanel } = await import('./audit-log-panel')
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(createElement(AuditLogPanel, { revision: 0 }))
  })
  expect(container.textContent).toContain('No entries yet')
  // EmptyState compact markup: muted illustration circle, not a bare <p>.
  expect(container.querySelector('.rounded-full.bg-muted\\/50')).not.toBeNull()
})

/**
 * A long DDL must scroll inside the dialog, never push Execute off-screen.
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

test('200-line DDL scrolls in the pre and keeps the Execute button', async () => {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ConfirmDialog } = await import('./confirm-dialog')
  const ddl = Array.from(
    { length: 200 },
    (_, i) => `GRANT SELECT ON db.t${i} TO u;`
  ).join('\n')
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(
      createElement(ConfirmDialog, {
        open: true,
        ddl,
        pending: false,
        statusMessage: null,
        statusIsError: false,
        onConfirm: () => {},
        onCancel: () => {},
      })
    )
  })
  const pre = document.body.querySelector('pre') as HTMLElement
  expect(pre.textContent).toContain('t199')
  expect(pre.className).toContain('overflow-auto')
  expect(pre.className).toContain('max-h-[50dvh]')
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
  expect(dialog.className).toContain('max-h-[90dvh]')
  const buttons = [...document.body.querySelectorAll('button')].map((b) =>
    b.textContent?.trim()
  )
  expect(buttons).toContain('Execute')
})

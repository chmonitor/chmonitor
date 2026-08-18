/**
 * Auth page HTML fallback (Clerk off in unit tests). happy-dom + react-dom.
 */

import type { ReactElement } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
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

afterEach(() => {
  document.body.replaceChildren()
})

async function renderInto(
  node: ReactElement
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

describe('AuthPage', () => {
  test('sign-in is HTML with the dashboard Sign in control fallback', async () => {
    const { AuthPage } = await import('./auth-page')
    const { container, cleanup } = await renderInto(<AuthPage mode="sign-in" />)

    expect(
      container.querySelector('[data-testid="sign-in-page"]')
    ).not.toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Sign in')
    expect(
      container.querySelector('[data-testid="auth-page-fallback"]')?.textContent
    ).toContain('Use the Sign in control in the dashboard sidebar')
    expect(container.textContent).not.toContain('# chmonitor')
    expect(container.querySelector('a[href="/overview?host=0"]')).not.toBeNull()

    await cleanup()
  })

  test('sign-up is HTML, not agent markdown', async () => {
    const { AuthPage } = await import('./auth-page')
    const { container, cleanup } = await renderInto(<AuthPage mode="sign-up" />)

    expect(
      container.querySelector('[data-testid="sign-up-page"]')
    ).not.toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Create an account')
    expect(container.textContent).not.toContain('# auth.md')

    await cleanup()
  })
})

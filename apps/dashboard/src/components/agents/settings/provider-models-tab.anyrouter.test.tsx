/**
 * The "Sign in with AnyRouter" row in Provider & Models settings.
 *
 * Why it matters: the sign-in routes 404 when `agent.anyrouterSignin` is off,
 * so offering the button then is a dead end; and a connected user must always
 * see the connected state and a way to sign out, or a spendable token stays
 * active with no visible control.
 */

import type { UseAnyRouterTokenResult } from '@/lib/hooks/use-anyrouter-token'

import {
  AnyRouterSignInRow,
  formatAnyRouterExpiry,
  shouldShowAnyRouterSignIn,
} from './provider-models-tab'
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
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

function state(
  overrides: Partial<UseAnyRouterTokenResult> = {}
): UseAnyRouterTokenResult {
  return {
    credential: null,
    isSignedIn: false,
    connectedVia: null,
    expiresAt: null,
    expired: false,
    signinEnabled: true,
    isSigningIn: false,
    error: null,
    signIn: () => {},
    signOut: () => {},
    ...overrides,
  }
}

async function render(anyRouter: UseAnyRouterTokenResult) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<AnyRouterSignInRow anyRouter={anyRouter} />)
  })
  const button = container.querySelector('button') as HTMLButtonElement
  return {
    text: container.textContent ?? '',
    button,
    click: async () => {
      await act(async () => button.click())
    },
    unmount: () => act(() => root.unmount()),
  }
}

describe('shouldShowAnyRouterSignIn', () => {
  test('flag off and not connected: hidden (the routes would 404)', () => {
    expect(
      shouldShowAnyRouterSignIn({ signinEnabled: false, isSignedIn: false })
    ).toBe(false)
  })

  test('flag on: shown, even when the deployment has its own key', () => {
    expect(
      shouldShowAnyRouterSignIn({ signinEnabled: true, isSignedIn: false })
    ).toBe(true)
  })

  test('connected with the flag off: still shown so the user can sign out', () => {
    expect(
      shouldShowAnyRouterSignIn({ signinEnabled: false, isSignedIn: true })
    ).toBe(true)
  })
})

describe('AnyRouterSignInRow', () => {
  test('signed out: offers sign-in with the no-daily-limit copy', async () => {
    const signIn = mock(() => {})
    const view = await render(state({ signIn }))
    expect(view.text).toContain('Sign in with AnyRouter')
    expect(view.text).toContain(
      'Use your own AnyRouter credits — no daily limit'
    )
    expect(view.button.textContent).toBe('Sign in')
    await view.click()
    expect(signIn).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  test('connected: shows connected state, expiry, and signs out', async () => {
    const signOut = mock(() => {})
    const expiresAt = Date.UTC(2030, 0, 2, 3, 4)
    const view = await render(
      state({
        isSignedIn: true,
        connectedVia: 'browser',
        credential: { token: 't', expiresAt },
        expiresAt,
        signOut,
      })
    )
    expect(view.text).toContain('Signed in with AnyRouter')
    expect(view.text).toContain('Connected')
    expect(view.text).toContain(`Expires ${formatAnyRouterExpiry(expiresAt)}`)
    expect(view.button.textContent).toBe('Sign out')
    await view.click()
    expect(signOut).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  test('connected via the account (no browser token) still reads as connected', async () => {
    const view = await render(
      state({ isSignedIn: true, connectedVia: 'account', expiresAt: null })
    )
    expect(view.text).toContain('Connected')
    expect(view.text).toContain('saved to your account')
    expect(view.text).not.toContain('Expires')
    await view.unmount()
  })

  test('expired: prompts to sign in again', async () => {
    const signIn = mock(() => {})
    const view = await render(state({ expired: true, signIn }))
    expect(view.text).toContain('Sign in with AnyRouter again')
    expect(view.text).not.toContain('Connected')
    expect(view.button.textContent).toBe('Sign in again')
    await view.click()
    expect(signIn).toHaveBeenCalledTimes(1)
    await view.unmount()
  })
})

/**
 * `useNotificationPermission` — the hook behind the browser-notification toggle.
 *
 * The bug it exists to fix: `DEFAULT_ALERT_SETTINGS.browserNotificationsEnabled`
 * is `true`, so the switch read as "on" while `Notification.permission` was
 * still `'default'` and nothing was ever delivered. These tests pin the live
 * permission reads, both sync paths (`navigator.permissions` `onchange` and the
 * Safari `visibilitychange`/`focus` fallback), and cleanup.
 *
 * Uses `happy-dom` + `react-dom/client` + `act`, the harness established by
 * `components/dashboard/time-range-context.test.tsx` — the repo has no other
 * DOM test setup (components are otherwise covered by Cypress).
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * `bun test` runs every file in one process, so a DOM registration that does
 * not fully unwind leaks into unrelated suites — `server-sweep.test.ts` assigns
 * `globalThis.fetch` and would silently exercise happy-dom's implementation
 * instead of its own mock. Snapshot the globals we touch and put them back
 * ourselves rather than trusting the registrator to.
 */
const savedGlobals: {
  fetch?: typeof globalThis.fetch
  actEnv?: boolean
} = {}

beforeAll(() => {
  savedGlobals.fetch = globalThis.fetch
  savedGlobals.actEnv = (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
  if (savedGlobals.fetch) globalThis.fetch = savedGlobals.fetch
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = savedGlobals.actEnv
})

type PermissionState = 'default' | 'granted' | 'denied'

interface FakePermissionStatus {
  state: string
  onchange: (() => void) | null
}

/**
 * Install a fake `Notification` + `navigator.permissions` pair.
 *
 * Returns handles the test drives: `setPermission` to move the browser-level
 * permission, `status` to fire the `permissions` change event, and
 * `queryCalls` to assert the descriptor the hook asked for.
 */
function stubBrowser(options: {
  initial: PermissionState
  /** Omit the Notification API entirely (the 'unsupported' path). */
  unsupported?: boolean
  /** Reject `permissions.query`, as Safari does for 'notifications'. */
  permissionsUnavailable?: boolean
  /** Result `Notification.requestPermission()` resolves to. */
  requestResult?: PermissionState
  /** Make `requestPermission()` reject. */
  requestRejects?: boolean
}) {
  const state = { current: options.initial }
  const status: FakePermissionStatus = {
    state: options.initial,
    onchange: null,
  }
  let requestCalls = 0

  const globals = globalThis as Record<string, unknown>
  const originalNotification = globals.Notification
  const originalPermissions = (
    globalThis.navigator as { permissions?: unknown }
  ).permissions

  if (options.unsupported) {
    globals.Notification = undefined
    // `'Notification' in window` must be false, not just undefined-valued.
    delete (globalThis as Record<string, unknown>).Notification
  } else {
    globals.Notification = {
      get permission() {
        return state.current
      },
      requestPermission: async () => {
        requestCalls += 1
        if (options.requestRejects) throw new Error('denied by browser')
        const result = options.requestResult ?? 'granted'
        state.current = result
        return result
      },
    }
  }

  Object.defineProperty(globalThis.navigator, 'permissions', {
    configurable: true,
    value: options.permissionsUnavailable
      ? {
          query: async () => {
            throw new Error('not a known permission name')
          },
        }
      : { query: async () => status },
  })

  return {
    status,
    setPermission: (next: PermissionState) => {
      state.current = next
      status.state = next
    },
    get requestCalls() {
      return requestCalls
    },
    restore: () => {
      if (originalNotification === undefined) {
        delete (globalThis as Record<string, unknown>).Notification
      } else {
        globals.Notification = originalNotification
      }
      Object.defineProperty(globalThis.navigator, 'permissions', {
        configurable: true,
        value: originalPermissions,
      })
    },
  }
}

/** Mount the hook and expose its latest return value. */
async function renderHook() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useNotificationPermission } = await import(
    '../use-notification-permission'
  )

  const seen: ReturnType<typeof useNotificationPermission>[] = []
  function Probe() {
    seen.push(useNotificationPermission())
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(Probe))
  })

  return {
    get latest() {
      return seen[seen.length - 1]
    },
    act,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

let stub: ReturnType<typeof stubBrowser> | undefined

afterEach(() => {
  stub?.restore()
  stub = undefined
})

describe('useNotificationPermission', () => {
  test('an ungranted permission is not "can notify" — the original bug', async () => {
    // The stored preference defaults to enabled; if the hook reported anything
    // but canNotify=false here, the toggle would read as working while the
    // browser delivered nothing.
    stub = stubBrowser({ initial: 'default' })
    const hook = await renderHook()

    expect(hook.latest.state).toBe('default')
    expect(hook.latest.canNotify).toBe(false)
    expect(hook.latest.isBlocked).toBe(false)

    await hook.unmount()
  })

  test('reports granted / denied / unsupported distinctly', async () => {
    stub = stubBrowser({ initial: 'granted' })
    let hook = await renderHook()
    expect(hook.latest.state).toBe('granted')
    expect(hook.latest.canNotify).toBe(true)
    expect(hook.latest.isBlocked).toBe(false)
    await hook.unmount()
    stub.restore()

    stub = stubBrowser({ initial: 'denied' })
    hook = await renderHook()
    expect(hook.latest.state).toBe('denied')
    expect(hook.latest.canNotify).toBe(false)
    expect(hook.latest.isBlocked).toBe(true)
    await hook.unmount()
    stub.restore()

    stub = stubBrowser({ initial: 'default', unsupported: true })
    hook = await renderHook()
    expect(hook.latest.state).toBe('unsupported')
    expect(hook.latest.canNotify).toBe(false)
    await hook.unmount()
  })

  test('a permissions onchange flips the state without a remount', async () => {
    // The user unblocking the site in browser UI must re-enable the toggle
    // without a page reload.
    stub = stubBrowser({ initial: 'denied' })
    const hook = await renderHook()
    expect(hook.latest.isBlocked).toBe(true)

    stub.setPermission('granted')
    await hook.act(async () => {
      stub?.status.onchange?.()
    })

    expect(hook.latest.state).toBe('granted')
    expect(hook.latest.canNotify).toBe(true)

    await hook.unmount()
  })

  test('falls back to visibilitychange when permissions.query rejects (Safari)', async () => {
    stub = stubBrowser({ initial: 'default', permissionsUnavailable: true })
    const hook = await renderHook()
    expect(hook.latest.state).toBe('default')

    stub.setPermission('granted')
    await hook.act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(hook.latest.state).toBe('granted')
    await hook.unmount()
  })

  test('falls back to window focus as well', async () => {
    stub = stubBrowser({ initial: 'default', permissionsUnavailable: true })
    const hook = await renderHook()

    stub.setPermission('denied')
    await hook.act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(hook.latest.isBlocked).toBe(true)
    await hook.unmount()
  })

  test('request() asks the browser and adopts the result', async () => {
    stub = stubBrowser({ initial: 'default', requestResult: 'granted' })
    const hook = await renderHook()

    let result: string | undefined
    await hook.act(async () => {
      result = await hook.latest.request()
    })

    expect(result).toBe('granted')
    expect(stub.requestCalls).toBe(1)
    expect(hook.latest.canNotify).toBe(true)

    await hook.unmount()
  })

  test('request() surfaces a refusal rather than claiming success', async () => {
    stub = stubBrowser({ initial: 'default', requestResult: 'denied' })
    const hook = await renderHook()

    let result: string | undefined
    await hook.act(async () => {
      result = await hook.latest.request()
    })

    expect(result).toBe('denied')
    expect(hook.latest.canNotify).toBe(false)
    expect(hook.latest.isBlocked).toBe(true)

    await hook.unmount()
  })

  test('request() on an unsupported browser resolves without throwing', async () => {
    stub = stubBrowser({ initial: 'default', unsupported: true })
    const hook = await renderHook()

    let result: string | undefined
    await hook.act(async () => {
      result = await hook.latest.request()
    })

    expect(result).toBe('unsupported')
    await hook.unmount()
  })

  test('a rejected request() leaves the state readable, not thrown', async () => {
    stub = stubBrowser({ initial: 'default', requestRejects: true })
    const hook = await renderHook()

    let result: string | undefined
    await hook.act(async () => {
      result = await hook.latest.request()
    })

    expect(result).toBe('default')
    expect(hook.latest.canNotify).toBe(false)
    await hook.unmount()
  })

  test('unmount detaches onchange and the window listeners', async () => {
    // Opening settings twice in a session would otherwise leak a listener per
    // mount, each holding a setState on an unmounted tree.
    stub = stubBrowser({ initial: 'granted' })
    const hook = await renderHook()
    expect(stub.status.onchange).not.toBeNull()

    await hook.unmount()

    expect(stub.status.onchange).toBeNull()

    const before = hook.latest.state
    stub.setPermission('denied')
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    // No further render happened, so the last observed value is unchanged.
    expect(hook.latest.state).toBe(before)
  })
})

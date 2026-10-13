/**
 * #3802 — in cloud mode the scheduled sweep only checks the env (demo) hosts,
 * never a signed-in user's own connections, so a maintenance window or quiet
 * hours saved from the UI cannot silence anything yet. Both panels must say so
 * in cloud mode and say nothing on a self-hosted build.
 *
 * Cloud mode is the baked `VITE_CLOUD_MODE`; Bun's `import.meta.env` is
 * `process.env`, so the test flips it per case.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

mock.module('sonner', () => ({
  toast: { success: mock(() => {}), error: mock(() => {}) },
}))

const realFetch = globalThis.fetch
const realCloudMode = process.env.VITE_CLOUD_MODE

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    // Leave the capability probe pending: the notice must not depend on it.
    if (url.includes('/api/v1/config')) return new Promise<Response>(() => {})
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
  if (realCloudMode === undefined) delete process.env.VITE_CLOUD_MODE
  else process.env.VITE_CLOUD_MODE = realCloudMode
})

async function render(element: unknown) {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(QueryClientProvider, { client }, element as never)
    )
  )
  return {
    notice: () => container.querySelector('[data-silencing-scope]'),
    unmount: async () => {
      await act(async () => root.unmount())
      client.clear()
    },
  }
}

const PANELS = [
  {
    name: 'MaintenanceWindowsPanel',
    load: async () =>
      (await import('./maintenance-windows-panel')).MaintenanceWindowsPanel,
  },
  {
    name: 'QuietHoursPanel',
    load: async () => (await import('./quiet-hours-panel')).QuietHoursPanel,
  },
]

describe('silencingScopeNoticeText', () => {
  test('cloud mode: names the user’s own connections and that they are not swept', async () => {
    const { silencingScopeNoticeText } = await import(
      './silencing-scope-notice'
    )
    const text = silencingScopeNoticeText('Maintenance windows', true)
    expect(text).toContain('Maintenance windows')
    expect(text).toContain('your own connections')
    expect(text).toContain('not checked for alerts yet')
  })

  test('self-hosted: no notice', async () => {
    const { silencingScopeNoticeText } = await import(
      './silencing-scope-notice'
    )
    expect(silencingScopeNoticeText('Quiet hours', false)).toBeNull()
  })
})

describe.each(PANELS)('$name', ({ load }) => {
  test('cloud mode renders the scope notice', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    const Panel = await load()
    const { createElement } = await import('react')
    const view = await render(createElement(Panel))
    expect(view.notice()?.textContent).toContain('your own connections')
    await view.unmount()
  })

  test('self-hosted renders no scope notice', async () => {
    delete process.env.VITE_CLOUD_MODE
    const Panel = await load()
    const { createElement } = await import('react')
    const view = await render(createElement(Panel))
    expect(view.notice()).toBeNull()
    await view.unmount()
  })
})

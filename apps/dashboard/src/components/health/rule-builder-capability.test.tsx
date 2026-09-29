/**
 * #3495 — the rule builder never renders an enabled write affordance it cannot
 * honour. Rendered against the REAL `FeaturePermissionsProvider` and React
 * Query with `fetch` stubbed, so the capability travels the same path it does
 * in the app: `/api/v1/config` → `useHealthStoreAvailability` → `disabled`.
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

type ConfigAnswer = 'pending' | 'none' | 'd1' | 'absent'
let configAnswer: ConfigAnswer = 'pending'
let rulesStatus = 200
let rulesData: unknown[] = []
const realFetch = globalThis.fetch

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/api/v1/config')) {
      if (configAnswer === 'pending') return new Promise<Response>(() => {})
      const base = {
        authProvider: 'none',
        principal: 'anonymous',
        features: {},
      }
      if (configAnswer === 'absent')
        return json({ ...base, capabilities: { read: true, write: true } })
      return json({
        ...base,
        capabilities: {
          read: true,
          write: true,
          health: {
            backend: configAnswer,
            maintenanceWindowsBackend: configAnswer,
          },
        },
      })
    }
    if (url.includes('/api/v1/health/custom-rules')) {
      if (rulesStatus === 501)
        return json(
          { success: false, error: { code: 'NOT_CONFIGURED', message: 'x' } },
          501
        )
      return json({ success: true, data: rulesData })
    }
    return json({})
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
  configAnswer = 'pending'
  rulesStatus = 200
  rulesData = []
})

async function render() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const { FeaturePermissionsProvider } = await import(
    '@/lib/feature-permissions/context'
  )
  const { RuleBuilderPanel } = await import('./rule-builder')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          FeaturePermissionsProvider,
          null,
          createElement(RuleBuilderPanel)
        )
      )
    )
  })
  // Let the stubbed fetches resolve and React Query settle.
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  return container
}

function saveButton(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Save rule'
  )
}

describe('RuleBuilderPanel write gating (#3495)', () => {
  test('unknown (config not answered) renders Save DISABLED', async () => {
    const c = await render()
    expect(saveButton(c)?.disabled).toBe(true)
    expect(c.querySelector('[data-health-store="unknown"]')).not.toBeNull()
  })

  test('unknown (older server, no health field) renders Save DISABLED', async () => {
    configAnswer = 'absent'
    const c = await render()
    expect(saveButton(c)?.disabled).toBe(true)
  })

  test('unavailable (backend none) shows the notice and no Save at all', async () => {
    configAnswer = 'none'
    const c = await render()
    expect(saveButton(c)).toBeUndefined()
    expect(c.querySelector('[data-health-store="unavailable"]')).not.toBeNull()
  })

  // #3497: with no DB, rules from the health config directory still fire, so
  // the panel lists them (read-only, no Delete) instead of hiding them.
  test('unavailable with declarative rules lists them read-only, no Save', async () => {
    configAnswer = 'none'
    rulesData = [
      {
        id: 'custom:disk',
        name: 'Disk nearly full',
        metric: 'disk',
        op: '>=',
        warning: 80,
        critical: 90,
        enabled: true,
        createdAt: 0,
        source: 'file',
      },
    ]
    const c = await render()
    expect(c.textContent).toContain('Disk nearly full')
    expect(c.textContent).toContain('Config file')
    expect(
      [...c.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Delete'
      )
    ).toBe(false)
    expect(saveButton(c)).toBeUndefined()
  })

  test('a 501 from the store vetoes a declared d1 backend', async () => {
    configAnswer = 'd1'
    rulesStatus = 501
    const c = await render()
    expect(saveButton(c)).toBeUndefined()
    expect(c.querySelector('[data-health-store="unavailable"]')).not.toBeNull()
  })

  test('available (d1) renders Save enabled and no notice', async () => {
    configAnswer = 'd1'
    const c = await render()
    expect(c.querySelector('[data-health-store]')).toBeNull()
    expect(saveButton(c)?.disabled).toBe(false)
  })
})

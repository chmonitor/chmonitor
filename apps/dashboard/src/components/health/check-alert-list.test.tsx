/**
 * #3438 (PR 2/3) — the built-in alert list in Alert Settings → Alerts.
 *
 * Rendered against the REAL `FeaturePermissionsProvider` and React Query with
 * `fetch` stubbed, so the capability travels the same path as in the app:
 * `/api/v1/config` → `useHealthStoreAvailability` → rename disabled. Pins:
 * - every built-in alert renders with its name and stable id;
 * - rename sends PUT to `/check-alerts/<checkId>` (the id, never the name);
 * - no metadata DB: the list still renders, rename is disabled with a notice;
 * - name resolution prefers the stored name and falls back to the default.
 */

import type { CheckAlertInfo } from '@/lib/hooks/use-check-alerts'

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
mock.module('@/lib/swr/use-host', () => ({ useHostId: () => 0 }))

type Backend = 'pending' | 'none' | 'd1'
let backend: Backend = 'pending'
const calls: { url: string; method: string; body?: string }[] = []
const realFetch = globalThis.fetch

const ALERTS = [
  {
    checkId: 'max-parts',
    ruleId: 'max-parts',
    name: 'Parts per partition',
    defaultName: 'Parts per partition',
    source: 'default',
    updatedAt: null,
  },
  {
    checkId: 'disk-usage',
    ruleId: 'disk-usage',
    name: 'Prod disk',
    defaultName: 'Disk Usage',
    source: 'd1',
    updatedAt: 1,
  },
]

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
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body as string | undefined })
    if (url.includes('/api/v1/config')) {
      if (backend === 'pending') return new Promise<Response>(() => {})
      return json({
        authProvider: 'none',
        principal: 'anonymous',
        features: {},
        capabilities: {
          read: true,
          write: true,
          health: { backend, maintenanceWindowsBackend: backend },
        },
      })
    }
    if (url.includes('/api/v1/health/check-alerts/')) {
      const { name } = JSON.parse(String(init?.body ?? '{}'))
      return json({
        success: true,
        data: { ...ALERTS[0], name, source: 'd1', updatedAt: 2 },
      })
    }
    if (url.includes('/api/v1/health/check-alerts'))
      return json({ success: true, data: ALERTS })
    if (url.includes('/api/v1/health/alert-state'))
      return json({
        success: true,
        states: [
          {
            hostId: 0,
            ruleId: 'disk-usage',
            severity: 'critical',
            updatedAt: 1,
          },
        ],
      })
    return json({})
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
  backend = 'pending'
  calls.length = 0
})

async function settle() {
  const { act } = await import('react')
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
}

async function render() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const { FeaturePermissionsProvider } = await import(
    '@/lib/feature-permissions/context'
  )
  const { CheckAlertList } = await import('./check-alert-list')

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
          createElement(CheckAlertList)
        )
      )
    )
  })
  await settle()
  return container
}

const button = (c: HTMLElement, label: string) =>
  c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

describe('CheckAlertList (#3438)', () => {
  test('lists every built-in alert with its name, id and live state', async () => {
    backend = 'd1'
    const c = await render()
    expect(c.querySelectorAll('[data-check-alert]')).toHaveLength(2)
    const disk = c.querySelector('[data-check-alert="disk-usage"]')
    expect(disk?.textContent).toContain('Prod disk')
    expect(disk?.textContent).toContain('disk-usage')
    expect(disk?.textContent).toContain('Critical')
    // Only a stored name offers a reset.
    expect(button(c, 'Reset Prod disk to default name')).not.toBeNull()
    expect(button(c, 'Reset Parts per partition to default name')).toBeNull()
  })

  test('rename PUTs the new name to the check id', async () => {
    backend = 'd1'
    const c = await render()
    const { act } = await import('react')
    const rename = button(c, 'Rename Parts per partition')
    expect(rename?.disabled).toBe(false)
    await act(async () => rename?.click())
    const input = c.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Parts per partition"]'
    )
    expect(input).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'Too many parts')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button(c, 'Save name')?.click())
    await settle()
    const put = calls.find((x) => x.method === 'PUT')
    expect(put?.url).toContain('/api/v1/health/check-alerts/max-parts')
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ name: 'Too many parts' })
  })

  test('no metadata DB: list still renders, rename disabled with the notice', async () => {
    backend = 'none'
    const c = await render()
    expect(c.querySelectorAll('[data-check-alert]')).toHaveLength(2)
    expect(button(c, 'Rename Parts per partition')?.disabled).toBe(true)
    expect(button(c, 'Reset Prod disk to default name')?.disabled).toBe(true)
    expect(c.querySelector('[data-health-store="unavailable"]')).not.toBeNull()
  })

  test('unknown (config not answered) keeps rename disabled', async () => {
    const c = await render()
    expect(button(c, 'Rename Parts per partition')?.disabled).toBe(true)
    expect(c.querySelector('[data-health-store="unknown"]')).not.toBeNull()
  })
})

describe('resolveCheckAlertName', () => {
  test('stored name, then caller label, then browser title, then id', async () => {
    const { resolveCheckAlertName } = await import(
      '@/lib/hooks/use-check-alerts'
    )
    const { HEALTH_CHECKS } = await import('./health-checks')
    const byId = new Map((ALERTS as CheckAlertInfo[]).map((a) => [a.ruleId, a]))
    expect(resolveCheckAlertName('disk-usage', byId)).toBe('Prod disk')
    const empty = new Map()
    expect(resolveCheckAlertName('custom:x', empty, 'My rule')).toBe('My rule')
    const check = HEALTH_CHECKS[0]
    expect(resolveCheckAlertName(check.id, empty)).toBe(check.title)
    expect(resolveCheckAlertName('unknown-id', empty)).toBe('unknown-id')
  })
})

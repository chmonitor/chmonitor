/**
 * #3498 — an ACK with no metadata DB would be discarded, so the Active alerts
 * panel never renders an enabled Acknowledge/Clear it cannot honour, and the
 * thresholds panel states that alert state resets on restart. Rendered against
 * the REAL `FeaturePermissionsProvider` and React Query with `fetch` stubbed,
 * so the capability travels `/api/v1/config` → `useHealthStoreAvailability`.
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
let acks: unknown[] = []
const realFetch = globalThis.fetch

const FINDING = {
  hostId: 0,
  hostName: 'ch-1',
  ruleId: 'disk',
  title: 'Disk usage',
  severity: 'critical',
  value: 95,
  label: '95%',
}

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
    if (url.includes('/api/v1/health/findings'))
      return json({ success: true, findings: [FINDING] })
    if (url.includes('/api/v1/health/ack')) return json({ success: true, acks })
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
  acks = []
})

async function render(which: 'active' | 'thresholds') {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const { FeaturePermissionsProvider } = await import(
    '@/lib/feature-permissions/context'
  )
  const { ActiveAlertsPanel } = await import('./active-alerts-panel')
  const { ThresholdsPanel } = await import('./thresholds-panel')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const panel =
    which === 'active'
      ? createElement(ActiveAlertsPanel)
      : createElement(ThresholdsPanel, {
          thresholds: {},
          setThresholds: () => {},
        })
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(FeaturePermissionsProvider, null, panel)
      )
    )
  })
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  return container
}

function button(c: HTMLElement, label: string) {
  return [...c.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  )
}

describe('ActiveAlertsPanel ACK gating (#3498)', () => {
  test('unknown (config not answered) renders Acknowledge DISABLED', async () => {
    const c = await render('active')
    expect(button(c, 'Acknowledge')?.disabled).toBe(true)
    expect(c.querySelector('[data-health-store="unknown"]')).not.toBeNull()
  })

  test('unknown (older server, no health field) renders Acknowledge DISABLED', async () => {
    configAnswer = 'absent'
    const c = await render('active')
    expect(button(c, 'Acknowledge')?.disabled).toBe(true)
  })

  test('unavailable (backend none) disables Acknowledge and shows the notice', async () => {
    configAnswer = 'none'
    const c = await render('active')
    expect(button(c, 'Acknowledge')?.disabled).toBe(true)
    expect(c.querySelector('[data-health-store="unavailable"]')).not.toBeNull()
  })

  test('unavailable disables Clear on an existing ACK', async () => {
    configAnswer = 'none'
    acks = [
      {
        ownerId: '',
        hostId: 0,
        ruleId: 'disk',
        ackedBy: 'operator',
        ackedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        note: '',
      },
    ]
    const c = await render('active')
    expect(button(c, 'Clear')?.disabled).toBe(true)
  })

  test('available (d1) enables Acknowledge and shows no notice', async () => {
    configAnswer = 'd1'
    const c = await render('active')
    expect(c.querySelector('[data-health-store]')).toBeNull()
    expect(button(c, 'Acknowledge')?.disabled).toBe(false)
  })
})

describe('ThresholdsPanel restart copy (#3498)', () => {
  test('unavailable states that alert state resets on restart', async () => {
    configAnswer = 'none'
    const c = await render('thresholds')
    const notice = c.querySelector('[data-alert-state-volatile]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('reset on every restart or deploy')
  })

  test('unknown and available say nothing', async () => {
    let c = await render('thresholds')
    expect(c.querySelector('[data-alert-state-volatile]')).toBeNull()
    document.body.replaceChildren()
    configAnswer = 'd1'
    c = await render('thresholds')
    expect(c.querySelector('[data-alert-state-volatile]')).toBeNull()
  })
})

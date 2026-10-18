/**
 * #3957: in cloud a signed-out visitor gets 401 from the per-owner health
 * config and Postgres reads, so the hooks must not request them and PgPage
 * shows a sign-in prompt. Self-hosted must keep requesting them. Clerk is off
 * in tests, so cloud mode alone makes the visitor signed out.
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

const PG_CONN = {
  connectionId: 'pg-1',
  source: 'browser' as const,
  name: 'pg',
  host: 'db',
  user: 'u',
  password: 'p',
}
mock.module('@/lib/hooks/use-active-pg-connection', () => ({
  useActivePgConnection: () => PG_CONN,
}))

const GATED = [
  '/api/v1/health/alert-config',
  '/api/v1/health/maint-windows',
  '/api/v1/health/quiet-hours',
  '/api/v1/health/peerdb-rules',
  '/api/v1/health/webhook-targets',
  '/api/v1/health/routes',
  '/api/v1/pg/query/',
]

const requested: string[] = []
const realFetch = globalThis.fetch

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input instanceof Request ? input.url : input))
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
  requested.length = 0
  delete process.env.VITE_CLOUD_MODE
})

async function renderAll() {
  const { act, createElement, Fragment } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const { useAlertChannelConfig } = await import(
    '@/lib/hooks/use-alert-channel-config'
  )
  const { useMaintenanceWindows } = await import(
    '@/lib/hooks/use-maintenance-windows'
  )
  const { useQuietHours } = await import('@/lib/hooks/use-quiet-hours')
  const { usePeerDBRules } = await import('@/lib/hooks/use-peerdb-rules')
  const { useCustomWebhookTargets } = await import(
    '@/lib/hooks/use-custom-webhook-targets'
  )
  const { useAlertRoutes } = await import('@/lib/hooks/use-alert-routes')
  const { PgPage } = await import('@/components/postgres/pg-page')

  function Hooks() {
    useAlertChannelConfig()
    useMaintenanceWindows()
    useQuietHours()
    usePeerDBRules()
    useCustomWebhookTargets()
    useAlertRoutes()
    return null
  }

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const config = { name: 'activity', title: 'Activity', sql: '', columns: [] }
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          Fragment,
          null,
          createElement(Hooks),
          createElement(PgPage, { config: config as never })
        )
      )
    )
  })
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  return container
}

const gatedRequests = () =>
  GATED.filter((path) => requested.some((url) => url.includes(path)))

describe('cloud signed-out gating (#3957)', () => {
  test('cloud signed-out: no gated request, Postgres shows the sign-in prompt', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    const c = await renderAll()
    expect(gatedRequests()).toEqual([])
    expect(
      c.querySelector('[data-testid="postgres-sign-in-required"]')
    ).not.toBeNull()
  })

  test('self-hosted: every gated endpoint is requested, no prompt', async () => {
    const c = await renderAll()
    expect(gatedRequests()).toEqual(GATED)
    expect(
      c.querySelector('[data-testid="postgres-sign-in-required"]')
    ).toBeNull()
  })
})

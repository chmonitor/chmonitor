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
  toast: {
    success: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
  },
}))

const realFetch = globalThis.fetch

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
  globalThis.fetch = realFetch
})

describe('RouteRow Send test', () => {
  test('webhook route test carries the deployment identity', async () => {
    const calls: { url: string; body?: string }[] = []
    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, body: init?.body as string | undefined })
        if (url.includes('/health/alert-identity')) {
          return new Response(JSON.stringify({ instanceName: 'prod-eu-1' }), {
            status: 200,
          })
        }
        return new Response('{}', { status: 200 })
      }
    ) as unknown as typeof fetch

    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { QueryClient, QueryClientProvider } = await import(
      '@tanstack/react-query'
    )
    const { RouteRow } = await import('./route-row')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <RouteRow
            onDeleted={() => {}}
            route={{
              id: 'r1',
              matchRule: '*',
              matchHost: '*',
              channelUrl: 'https://example.com/hook',
              enabled: true,
              createdAt: 0,
              provider: 'webhook',
              serviceName: null,
              routingKeyMasked: null,
              telegramChatId: null,
              telegramBotTokenMasked: null,
              ntfyUrl: null,
              ntfyTokenMasked: null,
              pushoverUser: null,
              pushoverTokenMasked: null,
              matrixHomeserverUrl: null,
              matrixRoomId: null,
              matrixAccessTokenMasked: null,
              minSeverity: null,
            }}
          />
        </QueryClientProvider>
      )
    })

    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Send test')
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
    })

    const send = calls.find((c) => c.url.includes('/health/webhook'))
    expect(send).toBeDefined()
    expect(send?.body).toContain('prod-eu-1')
    await act(async () => {
      root.unmount()
    })
  })
})

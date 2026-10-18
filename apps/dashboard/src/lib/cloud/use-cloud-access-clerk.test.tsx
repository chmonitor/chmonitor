/**
 * #3957 on a cloud build with Clerk: while Clerk loads, a visitor is neither
 * guest nor member, so PgPage shows no sign-in prompt (a signed-in user would
 * see it flash) and fetches nothing (a signed-out visitor would get a 401).
 * Once Clerk reports a signed-in user, the read goes out.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  mock,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

let clerkUser = { isLoaded: false, isSignedIn: false }
let clerkStatus = 'loading'
mock.module('@/lib/clerk/clerk-client', () => ({ isClerkEnabled: () => true }))
mock.module('@clerk/tanstack-react-start', () => ({
  useUser: () => clerkUser,
  useClerk: () => ({ status: clerkStatus }),
  SignInButton: ({ children }: { children: unknown }) => children,
}))
mock.module('@/lib/hooks/use-active-pg-connection', () => ({
  useActivePgConnection: () => ({
    connectionId: 'pg-1',
    source: 'browser',
    name: 'pg',
    host: 'db',
    user: 'u',
    password: 'p',
  }),
}))

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
  clerkStatus = 'loading'
  jest.useRealTimers()
})

async function renderPgPage() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const { PgPage } = await import('@/components/postgres/pg-page')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const config = { name: 'activity', title: 'Activity', sql: '', columns: [] }
  await act(async () => {
    createRoot(container).render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PgPage, { config: config as never })
      )
    )
  })
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((r) => setImmediate(r))
    })
  return container
}

const prompt = (c: HTMLElement) =>
  c.querySelector('[data-testid="postgres-sign-in-required"]')
const pgRequests = () =>
  requested.filter((u) => u.includes('/api/v1/pg/query/'))

describe('cloud with Clerk (#3957)', () => {
  test('Clerk loading: no prompt and no request', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    clerkUser = { isLoaded: false, isSignedIn: false }
    const c = await renderPgPage()
    expect(prompt(c)).toBeNull()
    expect(pgRequests()).toEqual([])
  })

  test('Clerk never loads: guest after the timeout, so the prompt shows (#3966)', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    clerkUser = { isLoaded: false, isSignedIn: false }
    jest.useFakeTimers({ doNotFake: ['setImmediate'] } as { now?: number })
    const { act } = await import('react')
    const c = await renderPgPage()
    expect(prompt(c)).toBeNull()
    await act(async () => {
      jest.advanceTimersByTime(8_000)
    })
    expect(prompt(c)).not.toBeNull()
    expect(pgRequests()).toEqual([])
  })

  test('Clerk reports a load error: guest straight away (#3966)', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    clerkUser = { isLoaded: false, isSignedIn: false }
    clerkStatus = 'error'
    const c = await renderPgPage()
    expect(prompt(c)).not.toBeNull()
    expect(pgRequests()).toEqual([])
  })

  test('signed out: prompt and no request', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    clerkUser = { isLoaded: true, isSignedIn: false }
    const c = await renderPgPage()
    expect(prompt(c)).not.toBeNull()
    expect(pgRequests()).toEqual([])
  })

  test('signed in: no prompt and the read goes out', async () => {
    process.env.VITE_CLOUD_MODE = 'true'
    clerkUser = { isLoaded: true, isSignedIn: true }
    const c = await renderPgPage()
    expect(prompt(c)).toBeNull()
    expect(pgRequests()).toHaveLength(1)
  })
})

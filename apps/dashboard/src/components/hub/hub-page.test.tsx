/**
 * A hub is the index of its sidebar group (#4265): on a fresh profile, where
 * the sidebar keeps only two Queries pages, /hub/queries still lists every
 * Queries page, undimmed, and marks the pinned ones.
 *
 * happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactNode } from 'react'

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
import * as realSwr from '@/lib/swr'

mock.module('@/components/menu/link-with-context', () => ({
  HostPrefixedLink: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string
    children?: ReactNode
    className?: string
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}))

// Process-global in bun: spread the real module so later files keep it.
mock.module('@/lib/swr', () => ({ ...realSwr, useHostId: () => 0 }))

const AVAILABILITY_KEY = ['/api/v1/table-availability', 0]

let unmount: (() => void) | undefined

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  const { act } = await import('react')
  act(() => unmount?.())
  unmount = undefined
  document.body.replaceChildren()
  const { __resetFavoritesForTests } = await import(
    '@/lib/menu/favorites-store'
  )
  localStorage.clear()
  __resetFavoritesForTests()
})

async function mountQueriesHub() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { HubPage } = await import('./hub-page')
  const { USER_SETTINGS_QUERY_KEY } = await import(
    '@/lib/hooks/use-user-settings'
  )
  const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')
  const {
    RouterContextProvider,
    createMemoryHistory,
    createRootRoute,
    createRouter,
  } = await import('@tanstack/react-router')

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/hub/queries'] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // A fresh profile: the default workspace hides most of each group.
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)
  const settled = { success: true, data: { available: {} } }
  queryClient.setQueryDefaults(AVAILABILITY_KEY, {
    queryFn: async () => settled,
  })
  queryClient.setQueryData(AVAILABILITY_KEY, settled)

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  unmount = () => root.unmount()
  await act(async () => {
    root.render(
      <RouterContextProvider router={router}>
        <QueryClientProvider client={queryClient}>
          <HubPage hubHref="/hub/queries" charts={[]} />
        </QueryClientProvider>
      </RouterContextProvider>
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container
}

const card = (container: HTMLElement, href: string) =>
  container.querySelector(`a[href="${href}"]`)

describe('HubPage', () => {
  test('lists a page hidden from the sidebar, undimmed', async () => {
    const container = await mountQueriesHub()
    const hidden = card(container, '/expensive-queries')
    expect(hidden).not.toBeNull()
    expect(hidden?.className).not.toContain('opacity-50')
    expect(container.textContent).not.toContain('hidden page')
  })

  test('a pinned page shows a pressed pin; others can be pinned', async () => {
    const { toggleFavorite } = await import('@/lib/menu/favorites-store')
    toggleFavorite('/expensive-queries')
    const container = await mountQueriesHub()

    const pinned = card(container, '/expensive-queries')?.parentElement
    const pin = pinned?.querySelector(':scope > button')
    expect(pin?.getAttribute('aria-pressed')).toBe('true')
    expect(pin?.getAttribute('aria-label')).toBe('Unpin Most Expensive Queries')

    const unpinned = card(container, '/failed-queries')?.parentElement
    expect(
      unpinned?.querySelector(':scope > button')?.getAttribute('aria-pressed')
    ).toBe('false')
  })
})

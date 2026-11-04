/**
 * The group hover flyout's "All pages" list (#4265). On a fresh profile the
 * sidebar keeps two Queries pages; the list must still offer every page of the
 * group, pinned first, and mark the pinned ones.
 *
 * happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactNode } from 'react'
import type { MenuItem } from '@/components/menu/types'

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

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let unmount: (() => void) | undefined

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

async function queriesPages(): Promise<MenuItem[]> {
  const { menuItemsConfig } = await import('@/menu')
  const group = menuItemsConfig.find((item) => item.title === 'Queries')
  if (!group?.items) throw new Error('Queries group missing from the menu')
  return group.items
}

async function mount(pages: MenuItem[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { GroupAllPages } = await import('./group-quick-links')
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
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // A fresh profile: the default workspace hides most of each group.
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  unmount = () => root.unmount()
  await act(async () => {
    root.render(
      <RouterContextProvider router={router}>
        <QueryClientProvider client={queryClient}>
          <GroupAllPages pages={pages} />
        </QueryClientProvider>
      </RouterContextProvider>
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { container, act }
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('li')].map((li) => {
    const link = li.querySelector('a') as HTMLAnchorElement
    const pin = li.querySelector('button') as HTMLButtonElement
    return {
      href: link.getAttribute('href'),
      muted: link.className.includes('text-muted-foreground'),
      pressed: pin.getAttribute('aria-pressed'),
      pin,
    }
  })

describe('GroupAllPages', () => {
  test('lists pages hidden from the sidebar, muted, after the sidebar pages', async () => {
    const pages = await queriesPages()
    const { container } = await mount(pages)
    const listed = rows(container)

    expect(listed.map((r) => r.href)).toHaveLength(
      pages.filter((p) => p.href).length
    )
    const hidden = listed.find((r) => r.href === '/expensive-queries')
    expect(hidden?.muted).toBe(true)
    expect(listed.slice(0, 2).map((r) => [r.href, r.muted])).toEqual([
      ['/running-queries', false],
      ['/history-queries', false],
    ])
  })

  test('a pinned page leads with a pressed pin; the toggle pins in place', async () => {
    const { toggleFavorite, getFavoriteHrefs } = await import(
      '@/lib/menu/favorites-store'
    )
    toggleFavorite('/expensive-queries')
    const { container, act } = await mount(await queriesPages())

    const [first, second] = rows(container)
    expect(first?.href).toBe('/expensive-queries')
    expect(first?.pressed).toBe('true')
    expect(first?.pin.getAttribute('aria-label')).toBe(
      'Unpin Most Expensive Queries'
    )
    expect(second?.pressed).toBe('false')

    await act(async () => {
      second?.pin.click()
    })
    expect(getFavoriteHrefs()).toEqual([
      '/expensive-queries',
      second?.href as string,
    ])
    expect(rows(container)[1]?.pressed).toBe('true')
  })
})

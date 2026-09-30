/**
 * Touch "…" row menu (#3580): the only path to pin / hide / reorder below
 * `lg`. happy-dom + react-dom/client, same harness as hide-button.test.tsx.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as typeof window.matchMedia
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

async function renderInto(
  node: ReactElement
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

async function openMenu(options: {
  href: string
  pinned: string[]
  /** Rendered Favorites order; omit for a row outside the Favorites group. */
  favoritesOrder?: string[]
}) {
  const { RowActionsMenu, FavoritesOrderProvider } = await import(
    './row-actions-menu'
  )
  const { SidebarProvider, SidebarMenu, SidebarMenuItem } = await import(
    '@/components/ui/sidebar'
  )
  const { USER_SETTINGS_QUERY_KEY } = await import(
    '@/lib/hooks/use-user-settings'
  )
  const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')
  const { __resetFavoritesForTests, pinFavorite } = await import(
    '@/lib/menu/favorites-store'
  )
  const {
    RouterContextProvider,
    createMemoryHistory,
    createRootRoute,
    createRouter,
  } = await import('@tanstack/react-router')

  localStorage.clear()
  __resetFavoritesForTests()
  for (const href of options.pinned) pinFavorite(href)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const menu = <RowActionsMenu href={options.href} title="Tables" />
  const rendered = await renderInto(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <SidebarMenu>
            <SidebarMenuItem>
              {options.favoritesOrder ? (
                <FavoritesOrderProvider value={options.favoritesOrder}>
                  {menu}
                </FavoritesOrderProvider>
              ) : (
                menu
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    </RouterContextProvider>
  )

  const trigger = rendered.container.querySelector(
    '[data-testid="row-actions-trigger"]'
  ) as HTMLButtonElement
  const { act } = await import('react')
  await act(async () => {
    trigger.click()
  })

  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]')
  )
  const click = async (label: string) => {
    await act(async () => {
      items.find((el) => el.textContent?.trim() === label)?.click()
    })
  }
  return { ...rendered, trigger, items, click, queryClient }
}

const labels = (items: HTMLElement[]) =>
  items.map((el) => el.textContent?.trim())

const isDisabled = (items: HTMLElement[], label: string) =>
  items
    .find((el) => el.textContent?.trim() === label)
    ?.hasAttribute('data-disabled')

describe('RowActionsMenu', () => {
  test('trigger is a labelled 36px button shown only below lg', async () => {
    const { trigger, cleanup } = await openMenu({ href: '/tables', pinned: [] })
    try {
      expect(trigger.tagName).toBe('BUTTON')
      expect(trigger.getAttribute('aria-label')).toBe('Page actions')
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
      expect(trigger.className).toContain('size-9')
      expect(trigger.className).toContain('lg:hidden')
    } finally {
      await cleanup()
    }
  })

  test('unpinned row offers Pin and Hide, and Pin pins it', async () => {
    const { items, click, cleanup } = await openMenu({
      href: '/tables',
      pinned: [],
    })
    const { getFavoriteHrefs } = await import('@/lib/menu/favorites-store')
    try {
      expect(labels(items)).toEqual(['Pin', 'Hide from sidebar'])
      await click('Pin')
      expect(getFavoriteHrefs()).toEqual(['/tables'])
    } finally {
      await cleanup()
    }
  })

  test('pinned row outside Favorites offers Unpin, no reorder', async () => {
    const { items, click, cleanup } = await openMenu({
      href: '/tables',
      pinned: ['/tables'],
    })
    const { getFavoriteHrefs } = await import('@/lib/menu/favorites-store')
    try {
      expect(labels(items)).toEqual(['Unpin', 'Hide from sidebar'])
      await click('Unpin')
      expect(getFavoriteHrefs()).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test('Favorites row adds Move up / Move down and Move down reorders', async () => {
    const order = ['/overview', '/tables', '/merges']
    const { items, click, cleanup } = await openMenu({
      href: '/tables',
      pinned: order,
      favoritesOrder: order,
    })
    const { getFavoriteHrefs } = await import('@/lib/menu/favorites-store')
    try {
      expect(labels(items)).toEqual([
        'Unpin',
        'Hide from sidebar',
        'Move up',
        'Move down',
      ])
      expect(isDisabled(items, 'Move up')).toBe(false)
      expect(isDisabled(items, 'Move down')).toBe(false)
      await click('Move down')
      expect(getFavoriteHrefs()).toEqual(['/overview', '/merges', '/tables'])
    } finally {
      await cleanup()
    }
  })

  test('first favorite cannot move up, last cannot move down', async () => {
    const order = ['/tables', '/merges']
    const first = await openMenu({
      href: '/tables',
      pinned: order,
      favoritesOrder: order,
    })
    try {
      expect(isDisabled(first.items, 'Move up')).toBe(true)
      expect(isDisabled(first.items, 'Move down')).toBe(false)
    } finally {
      await first.cleanup()
    }

    const last = await openMenu({
      href: '/merges',
      pinned: order,
      favoritesOrder: order,
    })
    try {
      expect(isDisabled(last.items, 'Move up')).toBe(false)
      expect(isDisabled(last.items, 'Move down')).toBe(true)
    } finally {
      await last.cleanup()
    }
  })

  test('Hide from sidebar writes hiddenMenuHrefs', async () => {
    const { click, cleanup, queryClient } = await openMenu({
      href: '/tables',
      pinned: [],
    })
    const { USER_SETTINGS_QUERY_KEY } = await import(
      '@/lib/hooks/use-user-settings'
    )
    try {
      await click('Hide from sidebar')
      const stored = queryClient.getQueryData(USER_SETTINGS_QUERY_KEY) as {
        hiddenMenuHrefs: string[]
      }
      expect(stored.hiddenMenuHrefs).toContain('/tables')
    } finally {
      await cleanup()
    }
  })
})

/**
 * Collapsible group follows client-side navigation: landing on a child
 * (palette, breadcrumb, in-page link) opens the parent so the active row is
 * visible, and a user collapse survives until the location changes again.
 *
 * Plus the availability hide guard (#3463): the leaf path, the sub-item path,
 * and the collapsed flyout must all agree for the same `tableCheck`, and a
 * group whose children are all hidden must render no parent row.
 *
 * happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement, ReactNode } from 'react'
import type { MenuItem as MenuItemType } from '@/components/menu/types'

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

// `mock.module` is process-global in bun, so the stub SPREADS the real module.
// A narrow replacement would strip every other export for every later test file.
mock.module('@/lib/swr', () => ({ ...realSwr, useHostId: () => 0 }))

/**
 * The availability map is a normal shared TanStack Query, so these tests drive
 * it through the cache instead of mocking the module: seeded data reads as a
 * SETTLED map, and `setQueryDefaults` with a never-settling queryFn reads as a
 * map still in flight.
 */
const AVAILABILITY_KEY = ['/api/v1/table-availability', 0]

function settleAvailability(available: Record<string, boolean>) {
  return (client: QueryClient) => {
    client.setQueryDefaults(AVAILABILITY_KEY, {
      queryFn: async () => ({ success: true, data: { available } }),
    })
    client.setQueryData(AVAILABILITY_KEY, {
      success: true,
      data: { available },
    })
  }
}

function leaveAvailabilityLoading() {
  return (client: QueryClient) => {
    client.setQueryDefaults(AVAILABILITY_KEY, {
      queryFn: () => new Promise<never>(() => {}),
    })
  }
}

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

const queriesGroup: MenuItemType = {
  title: 'Queries',
  href: '/running-queries',
  items: [
    { title: 'Running Queries', href: '/running-queries' },
    { title: 'History Queries', href: '/history-queries' },
  ],
}

/** One tableCheck leaf (like Traffic) and one config-gated leaf (like Scheduled Reports). */
const insightsGroup: MenuItemType = {
  title: 'Insights',
  href: '',
  items: [
    { title: 'Insights', href: '/insights' },
    { title: 'Traffic', href: '/traffic', tableCheck: 'system.query_log' },
    { title: 'Insights Settings', href: '/insights-settings' },
    {
      title: 'Scheduled Reports',
      href: '/report-settings',
      requiresMetadataDb: true,
    },
  ],
}

interface MountOptions {
  item?: MenuItemType
  /** `false` = the shipped default (Hide). */
  dimUnavailablePages?: boolean
  /** Which tables the host reports as missing; `null` leaves the map in flight. */
  missingTables?: Record<string, boolean> | null
}

async function mount({
  item = queriesGroup,
  dimUnavailablePages = false,
  missingTables = {},
}: MountOptions = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MenuItem } = await import('./menu-item')
  const { SidebarProvider, SidebarMenu } = await import(
    '@/components/ui/sidebar'
  )
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

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, {
    ...DEFAULT_USER_SETTINGS,
    dimUnavailablePages,
  })
  if (missingTables === null) leaveAvailabilityLoading()(queryClient)
  else settleAvailability(missingTables)(queryClient)

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const tree = (pathname: string): ReactElement => (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <SidebarMenu>
            <MenuItem item={item} pathname={pathname} />
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    </RouterContextProvider>
  )

  const render = async (pathname: string) => {
    await act(async () => {
      root.render(tree(pathname))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const subLinks = () =>
    [...container.querySelectorAll('[data-sidebar="menu-sub"] a')].map((a) =>
      a.getAttribute('href')
    )

  const links = () => [...container.querySelectorAll('a')]

  const linkFor = (title: string) =>
    links().find((a) => a.textContent?.includes(title))

  const trigger = () =>
    container.querySelector(
      '[data-slot="collapsible-trigger"]'
    ) as HTMLButtonElement | null

  const cleanup = async () => {
    await act(async () => {
      root.unmount()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    container.remove()
  }

  return { render, subLinks, links, linkFor, trigger, container, cleanup, act }
}

describe('MenuItem collapsible group', () => {
  test('opens when navigation lands on a child after mount', async () => {
    const m = await mount()
    try {
      await m.render('/overview')
      expect(m.subLinks()).toEqual([])

      await m.render('/history-queries')
      expect(m.subLinks()).toContain('/history-queries')
    } finally {
      await m.cleanup()
    }
  })

  test('user collapse holds until the location changes', async () => {
    const m = await mount()
    try {
      await m.render('/running-queries')
      expect(m.subLinks()).toContain('/running-queries')

      await m.act(async () => {
        m.trigger()?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(m.subLinks()).toEqual([])

      await m.render('/running-queries')
      expect(m.subLinks()).toEqual([])

      await m.render('/history-queries')
      expect(m.subLinks()).toContain('/history-queries')
    } finally {
      await m.cleanup()
    }
  })
})

describe('MenuItem availability hiding (#3463)', () => {
  test('sub-item path: a tableCheck leaf with no table leaves the rail by default', async () => {
    const m = await mount({ item: insightsGroup })
    try {
      await m.render('/insights')
      expect(m.subLinks()).toEqual([
        '/insights',
        '/traffic',
        '/insights-settings',
        '/report-settings',
      ])
    } finally {
      await m.cleanup()
    }
  })

  test('sub-item path: the same leaf disappears once the map reports it missing', async () => {
    const m = await mount({
      item: insightsGroup,
      missingTables: { 'system.query_log': false },
    })
    try {
      await m.render('/insights')
      expect(m.subLinks()).toEqual([
        '/insights',
        '/insights-settings',
        '/report-settings',
      ])
    } finally {
      await m.cleanup()
    }
  })

  test('Dim keeps the row greyed instead of removing it', async () => {
    const m = await mount({
      item: insightsGroup,
      dimUnavailablePages: true,
      missingTables: { 'system.query_log': false },
    })
    try {
      await m.render('/insights')
      const row = m.linkFor('Traffic')
      expect(row).toBeDefined()
      expect(row?.getAttribute('class')).toContain('opacity-50')
    } finally {
      await m.cleanup()
    }
  })

  test('a config-gated leaf dims rather than hides, so it stays discoverable', async () => {
    const m = await mount({ item: insightsGroup })
    try {
      await m.render('/insights')
      // No metadata DB configured → Scheduled Reports is dimmed, NOT removed.
      expect(m.subLinks()).toContain('/report-settings')
    } finally {
      await m.cleanup()
    }
  })

  test('leaf path: a top-level tableCheck page leaves the rail by default', async () => {
    const m = await mount({
      item: {
        title: 'Backups',
        href: '/backups',
        tableCheck: 'system.backup_log',
      },
      missingTables: { 'system.backup_log': false },
    })
    try {
      await m.render('/backups')
      expect(m.container.querySelector('a[href="/backups"]')).toBeNull()
    } finally {
      await m.cleanup()
    }
  })

  test('a group whose children are ALL hidden renders no parent row', async () => {
    const m = await mount({
      item: {
        title: 'Keeper',
        href: '',
        items: [
          {
            title: 'Info',
            href: '/keeper',
            tableCheck: 'system.zookeeper_info',
          },
          {
            title: 'Log',
            href: '/keeper-log',
            tableCheck: 'system.zookeeper_log',
          },
        ],
      },
      missingTables: {
        'system.zookeeper_info': false,
        'system.zookeeper_log': false,
      },
    })
    try {
      await m.render('/keeper')
      // No heading, no dangling chevron, no empty body.
      expect(m.trigger()).toBeNull()
      expect(m.links()).toEqual([])
    } finally {
      await m.cleanup()
    }
  })

  test('does not hide from an availability map that has not settled', async () => {
    const m = await mount({ item: insightsGroup, missingTables: null })
    try {
      await m.render('/insights')
      expect(m.subLinks()).toContain('/traffic')
    } finally {
      await m.cleanup()
    }
  })
})
describe('MenuItem subgroups (#3676)', () => {
  const STORAGE_KEY = 'chm-menu-subgroups-open'

  /** Real group/subgroup names, so the store keeps the keys on write. */
  const queriesWithSubgroups: MenuItemType = {
    title: 'Queries',
    href: '',
    items: [
      { title: 'Running', href: '/running-queries', subgroup: 'Live' },
      { title: 'Expensive', href: '/expensive-queries', subgroup: 'Live' },
      { title: 'History', href: '/history-queries', subgroup: 'History' },
      { title: 'Failed', href: '/failed-queries', subgroup: 'History' },
      { title: 'Thread', href: '/thread-analysis', subgroup: 'Performance' },
      { title: 'Patterns', href: '/query-patterns', subgroup: 'Performance' },
      { title: 'Cache', href: '/query-cache', subgroup: 'Caches' },
    ],
  }

  const subgroupTrigger = (container: HTMLElement, name: string) =>
    container.querySelector(
      `[data-testid="menu-subgroup-trigger"][data-subgroup="${name}"]`
    ) as HTMLButtonElement | null

  afterEach(() => {
    localStorage.clear()
  })

  test('opens only the subgroup that holds the active page', async () => {
    const m = await mount({ item: queriesWithSubgroups })
    try {
      await m.render('/history-queries')
      expect(
        subgroupTrigger(m.container, 'History')?.getAttribute('aria-expanded')
      ).toBe('true')
      expect(
        subgroupTrigger(m.container, 'Live')?.getAttribute('aria-expanded')
      ).toBe('false')
      // Live is collapsed: its pages are not rendered. A one-page subgroup
      // (Caches) is a plain row with no heading.
      expect(m.subLinks()).toContain('/history-queries')
      expect(m.subLinks()).not.toContain('/running-queries')
      expect(m.subLinks()).toContain('/query-cache')
      expect(subgroupTrigger(m.container, 'Caches')).toBeNull()
    } finally {
      await m.cleanup()
    }
  })

  test('the trigger is a real button that controls its list and persists its state', async () => {
    const m = await mount({ item: queriesWithSubgroups })
    try {
      await m.render('/history-queries')
      const live = subgroupTrigger(m.container, 'Live')
      expect(live?.tagName).toBe('BUTTON')
      expect(live?.getAttribute('type')).toBe('button')

      await m.act(async () => {
        live?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(live?.getAttribute('aria-expanded')).toBe('true')
      const controls = live?.getAttribute('aria-controls')
      expect(controls).toBeTruthy()
      const list = m.container.querySelector(`[id="${controls}"]`)
      expect(list?.querySelector('a[href="/running-queries"]')).not.toBeNull()
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
        'Queries/Live': true,
      })
    } finally {
      await m.cleanup()
    }

    // A fresh mount restores the saved open state for a non-active subgroup.
    const again = await mount({ item: queriesWithSubgroups })
    try {
      await again.render('/history-queries')
      expect(again.subLinks()).toContain('/running-queries')
    } finally {
      await again.cleanup()
    }
  })

  test('navigating onto a page in a collapsed subgroup opens it', async () => {
    const m = await mount({ item: queriesWithSubgroups })
    try {
      await m.render('/history-queries')
      expect(m.subLinks()).not.toContain('/thread-analysis')
      await m.render('/thread-analysis')
      expect(m.subLinks()).toContain('/thread-analysis')
    } finally {
      await m.cleanup()
    }
  })

  test('survives a localStorage that throws, falling back to the active-page rule', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const throwing = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
      removeItem() {},
      clear() {},
      key: () => null,
      length: 0,
    }
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: throwing,
    })
    const m = await mount({ item: queriesWithSubgroups })
    try {
      await m.render('/history-queries')
      expect(m.subLinks()).toContain('/history-queries')
      const live = subgroupTrigger(m.container, 'Live')
      await m.act(async () => {
        live?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(live?.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await m.cleanup()
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
    }
  })

  test('a group of 6 pages or fewer stays flat', async () => {
    const m = await mount({
      item: {
        ...queriesWithSubgroups,
        items: queriesWithSubgroups.items!.slice(0, 4),
      },
    })
    try {
      await m.render('/history-queries')
      expect(
        m.container.querySelectorAll('[data-testid="menu-subgroup-trigger"]')
          .length
      ).toBe(0)
      expect(m.subLinks()).toHaveLength(4)
    } finally {
      await m.cleanup()
    }
  })
})

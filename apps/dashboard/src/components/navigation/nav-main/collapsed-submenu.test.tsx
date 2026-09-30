/**
 * The collapsed-rail flyout must agree with the expanded rail (#3463): a page
 * hidden because its backing table is missing must not reappear here, or the
 * two surfaces would disagree about whether the page works on this host.
 *
 * happy-dom + react-dom/client. The availability map is driven through the
 * shared TanStack Query cache, so the real hook is what runs.
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

// `mock.module` is process-global in bun, so the stub SPREADS the real module.
// A narrow replacement would strip every other export for every later test file.
mock.module('@/lib/swr', () => ({ ...realSwr, useHostId: () => 0 }))

mock.module('@/components/menu/link-with-context', () => ({
  HostPrefixedLink: ({
    href,
    children,
    className,
    title,
  }: {
    href: string
    children?: ReactNode
    className?: string
    title?: string
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}))

const AVAILABILITY_KEY = ['/api/v1/table-availability', 0]

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

async function mount({
  item = insightsGroup,
  pathname = '/',
  direct = false,
  dimUnavailablePages = false,
  missingTables = {},
}: {
  item?: MenuItemType
  pathname?: string
  /** Render CollapsedSubmenu itself, bypassing MenuItem's own empty-group guard. */
  direct?: boolean
  dimUnavailablePages?: boolean
  missingTables?: Record<string, boolean>
} = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MenuItem } = await import('./menu-item')
  const { CollapsedSubmenu } = await import('./collapsed-submenu')
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
  queryClient.setQueryDefaults(AVAILABILITY_KEY, {
    queryFn: async () => ({
      success: true,
      data: { available: missingTables },
    }),
  })
  queryClient.setQueryData(AVAILABILITY_KEY, {
    success: true,
    data: { available: missingTables },
  })

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  // defaultOpen={false} puts the rail in `collapsed`, so MenuItem renders the
  // popover flyout instead of the expanded Collapsible.
  const tree = (): ReactElement => (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider defaultOpen={false}>
          <SidebarMenu>
            {direct ? (
              <CollapsedSubmenu
                item={item}
                pathname={pathname}
                trigger={<button type="button">trigger</button>}
              />
            ) : (
              <MenuItem item={item} pathname={pathname} />
            )}
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    </RouterContextProvider>
  )

  const render = async () => {
    await act(async () => {
      root.render(tree())
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  // The flyout opens on mouse-enter over the trigger wrapper. React delegates
  // enter/leave through mouseover, so that is what has to be dispatched.
  const openFlyout = async () => {
    const trigger = container.querySelector('button')
    if (!trigger) return
    await act(async () => {
      trigger.dispatchEvent(
        new window.MouseEvent('mouseover', { bubbles: true, cancelable: true })
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }

  const flyoutRows = () =>
    [...document.querySelectorAll('[data-slot="popover-content"] a')].map((a) =>
      a.getAttribute('href')
    )

  const cleanup = async () => {
    await act(async () => {
      root.unmount()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    container.remove()
  }

  return { render, openFlyout, flyoutRows, container, cleanup, act }
}

describe('collapsed submenu availability hiding (#3463)', () => {
  test('lists every child while the backing table is present', async () => {
    const m = await mount()
    try {
      await m.render()
      await m.openFlyout()
      expect(m.flyoutRows()).toEqual([
        '/insights',
        '/traffic',
        '/insights-settings',
        '/report-settings',
      ])
    } finally {
      await m.cleanup()
    }
  })

  test('a tableCheck leaf with no table is absent from the flyout, same as the expanded rail', async () => {
    const m = await mount({ missingTables: { 'system.query_log': false } })
    try {
      await m.render()
      await m.openFlyout()
      // Traffic is gone here AND in the expanded rail — the two surfaces agree.
      expect(m.flyoutRows()).toEqual([
        '/insights',
        '/insights-settings',
        '/report-settings',
      ])
    } finally {
      await m.cleanup()
    }
  })

  test('Dim keeps the flyout row greyed and titled with the reason', async () => {
    const m = await mount({
      dimUnavailablePages: true,
      missingTables: { 'system.query_log': false },
    })
    try {
      await m.render()
      await m.openFlyout()
      const row = [
        ...document.querySelectorAll('[data-slot="popover-content"] a'),
      ].find((a) => a.getAttribute('href') === '/traffic')
      expect(row).toBeDefined()
      expect(row?.getAttribute('class')).toContain('opacity-50')
      expect(row?.getAttribute('title')).toBe(
        'System table not found on this host'
      )
    } finally {
      await m.cleanup()
    }
  })

  test('a group whose children are ALL hidden renders no collapsed parent', async () => {
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
      await m.render()
      expect(m.container.querySelector('button')).toBeNull()
      await m.openFlyout()
      expect(m.flyoutRows()).toEqual([])
    } finally {
      await m.cleanup()
    }
  })
})

describe('CollapsedSubmenu used directly (visible children drive the flyout)', () => {
  const nested: MenuItemType = {
    title: 'Insights',
    href: '',
    items: [
      { title: 'Insights', href: '/insights' },
      {
        title: 'Traffic',
        href: '/insights/traffic',
        tableCheck: 'system.query_log',
      },
    ],
  }

  // MenuItem returns null for an empty group, so only a direct mount reaches
  // CollapsedSubmenu's own guard. With every child hidden it must fall back to
  // the bare trigger, not an empty popover.
  test('all children hidden -> bare trigger, no popover', async () => {
    const m = await mount({
      item: { ...nested, items: [nested.items![1]] },
      direct: true,
      missingTables: { 'system.query_log': false },
    })
    try {
      await m.render()
      await m.openFlyout()
      expect(m.container.querySelector('button')).not.toBeNull()
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    } finally {
      await m.cleanup()
    }
  })
})

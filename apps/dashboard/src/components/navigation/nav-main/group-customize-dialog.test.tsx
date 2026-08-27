/**
 * Group-heading customize dialog: lists catalog children, Add/Remove
 * writes hiddenMenuHrefs, 375 dialog opens without overflow-x.
 * happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement, ReactNode } from 'react'

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

async function renderQueriesDialog(open = false) {
  const { GroupCustomizeButton, GroupCustomizeDialog } = await import(
    './group-customize-dialog'
  )
  const { SidebarProvider, SidebarMenu, SidebarMenuItem } = await import(
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
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const node = (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <SidebarMenu>
            <SidebarMenuItem>
              {open ? (
                <GroupCustomizeDialog
                  open
                  onOpenChange={() => {}}
                  groupTitle="Queries"
                />
              ) : (
                <GroupCustomizeButton groupTitle="Queries" />
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    </RouterContextProvider>
  )

  const rendered = await renderInto(node)
  return { ...rendered, queryClient, DEFAULT_USER_SETTINGS }
}

describe('GroupCustomizeDialog', () => {
  test('heading + opens the Queries dialog; Add/Remove updates hiddenMenuHrefs', async () => {
    const { persistShowMenuHref } = await import('@/lib/menu/hide-menu-item')
    const { container, cleanup, queryClient, DEFAULT_USER_SETTINGS } =
      await renderQueriesDialog(false)

    try {
      expect(DEFAULT_USER_SETTINGS.hiddenMenuHrefs).toContain(
        '/history-queries'
      )
      expect(DEFAULT_USER_SETTINGS.hiddenMenuHrefs).not.toContain(
        '/running-queries'
      )

      const trigger = container.querySelector(
        '[data-testid="group-customize-button"][data-group="Queries"]'
      ) as HTMLButtonElement | null
      expect(trigger).not.toBeNull()
      expect(trigger?.getAttribute('aria-label')).toBe('Customize Queries')
      expect(trigger?.className).toContain('after:-inset-3')

      const { act } = await import('react')
      await act(async () => {
        trigger?.click()
      })

      const dialog = document.querySelector(
        '[data-testid="group-customize-dialog"]'
      ) as HTMLElement | null
      expect(dialog).not.toBeNull()
      expect(dialog?.textContent).toContain('Queries')
      expect(dialog?.textContent).toContain(
        'Add or remove pages in this group.'
      )

      const historyAdd = document.querySelector(
        '[data-testid="group-customize-add"][data-href="/history-queries"]'
      ) as HTMLButtonElement | null
      const runningRemove = document.querySelector(
        '[data-testid="group-customize-remove"][data-href="/running-queries"]'
      ) as HTMLButtonElement | null
      expect(historyAdd).not.toBeNull()
      expect(runningRemove).not.toBeNull()
      expect(
        document.querySelector(
          '[data-testid="group-customize-open"][data-href="/history-queries"]'
        )
      ).not.toBeNull()

      await act(async () => {
        historyAdd?.click()
      })

      const afterAdd = queryClient.getQueryData(
        (await import('@/lib/hooks/use-user-settings')).USER_SETTINGS_QUERY_KEY
      ) as { hiddenMenuHrefs: string[] }
      expect(afterAdd.hiddenMenuHrefs).not.toContain('/history-queries')
      expect(
        persistShowMenuHref(DEFAULT_USER_SETTINGS, '/history-queries')
          .hiddenMenuHrefs
      ).not.toContain('/history-queries')

      const historyRemove = document.querySelector(
        '[data-testid="group-customize-remove"][data-href="/history-queries"]'
      ) as HTMLButtonElement | null
      expect(historyRemove).not.toBeNull()

      await act(async () => {
        historyRemove?.click()
      })

      const afterRemove = queryClient.getQueryData(
        (await import('@/lib/hooks/use-user-settings')).USER_SETTINGS_QUERY_KEY
      ) as { hiddenMenuHrefs: string[] }
      expect(afterRemove.hiddenMenuHrefs).toContain('/history-queries')
    } finally {
      await cleanup()
    }
  })

  test('375: dialog opens with no overflow-x and fits the viewport', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 375,
    })

    const { cleanup } = await renderQueriesDialog(true)

    try {
      const dialog = document.querySelector(
        '[data-testid="group-customize-dialog"]'
      ) as HTMLElement | null
      expect(dialog).not.toBeNull()
      expect(dialog?.className).toContain('overflow-hidden')
      expect(dialog?.className).toContain('max-w-[calc(100%-2rem)]')
      expect(dialog?.className).not.toContain('overflow-x-auto')
      expect(dialog?.textContent).toContain('Queries')
      expect(
        document.querySelector('[data-testid="group-customize-done"]')
      ).not.toBeNull()
      expect(
        document.querySelector('[data-testid="group-customize-all-pages"]')
      ).not.toBeNull()
    } finally {
      await cleanup()
    }
  })
})

/**
 * Hover-hide control: type=button, does not navigate, 44px mobile hit area.
 * happy-dom + react-dom/client — same harness as nav-settings-button.test.tsx.
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

describe('HideButton', () => {
  test('is a button, does not follow a wrapping link, and has a 44px hit area', async () => {
    const { HideButton } = await import('./hide-button')
    const { SidebarProvider, SidebarMenu, SidebarMenuItem } = await import(
      '@/components/ui/sidebar'
    )
    const { USER_SETTINGS_QUERY_KEY } = await import(
      '@/lib/hooks/use-user-settings'
    )
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)

    let linkClicked = false

    const { container, cleanup } = await renderInto(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <SidebarMenu>
            <SidebarMenuItem>
              <a
                href="/overview"
                onClick={() => {
                  linkClicked = true
                }}
              >
                Overview
                <HideButton href="/overview" title="Overview" />
              </a>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    )

    try {
      const button = container.querySelector(
        '[data-testid="hide-menu-item"]'
      ) as HTMLButtonElement | null
      expect(button).not.toBeNull()
      expect(button?.tagName).toBe('BUTTON')
      expect(button?.getAttribute('aria-label')).toBe('Hide Overview from menu')
      expect(button?.className).toContain('after:-inset-3')

      const { act } = await import('react')
      await act(async () => {
        button?.click()
      })
      expect(linkClicked).toBe(false)
    } finally {
      await cleanup()
    }
  })
})

/**
 * Sidebar-footer settings gear: the trigger must exist next to Sign In /
 * avatar (`nav-settings-button`) and open the existing SettingsDialog.
 *
 * happy-dom + react-dom/client — same one-off harness as
 * `time-range-context.test.tsx`. Components are otherwise Cypress-covered.
 */

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

describe('NavSettingsButton', () => {
  test('ships nav-settings-button with an Open settings label', async () => {
    const { NavSettingsButton } = await import('./nav-settings-button')
    const { TooltipProvider } = await import('@/components/ui/tooltip')

    const { cleanup } = await renderInto(
      <TooltipProvider>
        <NavSettingsButton onClick={() => {}} />
      </TooltipProvider>
    )

    try {
      const button = document.querySelector(
        '[data-testid="nav-settings-button"]'
      )
      expect(button).not.toBeNull()
      expect(button?.getAttribute('aria-label')).toBe('Open settings')
    } finally {
      await cleanup()
    }
  })

  test('hides the gear when settings are not allowed', async () => {
    const { NavUserFooterRow } = await import('./nav-settings-button')

    const { cleanup } = await renderInto(
      <NavUserFooterRow canUseSettings={false} onOpenSettings={() => {}}>
        <span>Sign In</span>
      </NavUserFooterRow>
    )

    try {
      expect(
        document.querySelector('[data-testid="nav-settings-button"]')
      ).toBeNull()
    } finally {
      await cleanup()
    }
  })

  test('clicking the gear opens the existing SettingsDialog', async () => {
    const { act, useState } = await import('react')
    const { QueryClient, QueryClientProvider } = await import(
      '@tanstack/react-query'
    )
    const { NavSettingsButton } = await import('./nav-settings-button')
    const { SettingsDialog } = await import('@/components/settings')
    const { TooltipProvider } = await import('@/components/ui/tooltip')
    const { USER_SETTINGS_STORAGE_KEY, DEFAULT_USER_SETTINGS } = await import(
      '@/lib/types/user-settings'
    )

    // Seed local settings and stub the settings API so the real dialog/form
    // does not attempt a relative fetch against happy-dom's about:blank.
    localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify(DEFAULT_USER_SETTINGS)
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, data: { params: {} } }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <NavSettingsButton onClick={() => setOpen(true)} />
            <SettingsDialog open={open} onOpenChange={setOpen} />
          </TooltipProvider>
        </QueryClientProvider>
      )
    }

    const { cleanup } = await renderInto(<Harness />)

    try {
      expect(
        document.querySelector('[data-testid="settings-dialog"]')
      ).toBeNull()

      const button = document.querySelector(
        '[data-testid="nav-settings-button"]'
      )
      expect(button).not.toBeNull()

      await act(async () => {
        ;(button as HTMLButtonElement).click()
      })

      const dialog = document.querySelector('[data-testid="settings-dialog"]')
      expect(dialog).not.toBeNull()
      expect(dialog?.textContent).toContain('Settings')
      expect(dialog?.textContent).toContain('Local to this browser')
    } finally {
      globalThis.fetch = originalFetch
      await cleanup()
    }
  })
})

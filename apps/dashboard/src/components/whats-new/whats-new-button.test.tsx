/**
 * What's new button sits immediately left of Settings and shows a unseen dot.
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

describe("What's new button", () => {
  test('sits immediately left of Settings in the nav-user footer', async () => {
    const { NavUserFooterRow } = await import(
      '@/components/nav-user/nav-settings-button'
    )
    const { TooltipProvider } = await import('@/components/ui/tooltip')

    const { cleanup } = await renderInto(
      <TooltipProvider>
        <NavUserFooterRow canUseSettings={true} onOpenSettings={() => {}}>
          <span>Sign In</span>
        </NavUserFooterRow>
      </TooltipProvider>
    )

    try {
      const whatsNew = document.querySelector(
        '[data-testid="whats-new-button"]'
      )
      const settings = document.querySelector(
        '[data-testid="nav-settings-button"]'
      )
      expect(whatsNew).not.toBeNull()
      expect(settings).not.toBeNull()
      expect(whatsNew?.getAttribute('aria-label')).toBe("What's new")
      expect(whatsNew?.className).toContain('min-h-11')
      expect(whatsNew?.className).toContain('min-w-11')

      const parent = whatsNew?.closest('div.flex')
      const kids = [...(parent?.querySelectorAll('button') ?? [])]
      const whatsNewIndex = kids.indexOf(whatsNew as HTMLButtonElement)
      const settingsIndex = kids.indexOf(settings as HTMLButtonElement)
      expect(whatsNewIndex).toBeGreaterThanOrEqual(0)
      expect(settingsIndex).toBe(whatsNewIndex + 1)
    } finally {
      await cleanup()
    }
  })

  test('shows a badge dot when there are unseen versions', async () => {
    const { WhatsNewButton } = await import('./whats-new-button')
    const { TooltipProvider } = await import('@/components/ui/tooltip')

    const { cleanup } = await renderInto(
      <TooltipProvider>
        <WhatsNewButton hasUnseen onClick={() => {}} />
      </TooltipProvider>
    )

    try {
      expect(
        document.querySelector('[data-testid="whats-new-badge"]')
      ).not.toBeNull()
    } finally {
      await cleanup()
    }
  })

  test('hides the badge when versions have been seen', async () => {
    const { WhatsNewButton } = await import('./whats-new-button')
    const { TooltipProvider } = await import('@/components/ui/tooltip')

    const { cleanup } = await renderInto(
      <TooltipProvider>
        <WhatsNewButton hasUnseen={false} onClick={() => {}} />
      </TooltipProvider>
    )

    try {
      expect(
        document.querySelector('[data-testid="whats-new-badge"]')
      ).toBeNull()
    } finally {
      await cleanup()
    }
  })
})

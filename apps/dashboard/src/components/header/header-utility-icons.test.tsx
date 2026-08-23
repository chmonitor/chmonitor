/**
 * Persistent header utility icons (refresh, search, theme) must be 44×44
 * below lg. Glyph stays 16–20px. Time chips and the sidebar toggle are
 * covered by time-range-picker.test.tsx.
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

function expectPhoneTapTarget(el: Element) {
  expect(el.className).toContain('min-h-11')
  expect(el.className).toContain('min-w-11')
  expect(el.className).toContain('lg:min-h-8')
  expect(el.className).toContain('lg:min-w-8')
}

describe('header utility icons', () => {
  test('auto-refresh is a 44px tap target below lg', async () => {
    const { AppProvider } = await import('@/lib/context/app-context')
    const { RefreshCountdown } = await import('./refresh-countdown')
    const { container, cleanup } = await renderInto(
      <AppProvider>
        <RefreshCountdown />
      </AppProvider>
    )

    const button = container.querySelector('button[aria-label^="Auto refresh"]')
    expect(button).not.toBeNull()
    expectPhoneTapTarget(button as Element)
    expect(button?.innerHTML).toContain('h-3.5')

    await cleanup()
  })

  test('search icon is a 44px tap target below lg', async () => {
    const { CommandPaletteTrigger } = await import(
      '@/components/controls/command-palette/command-palette-items'
    )
    const { TooltipProvider } = await import('@/components/ui/tooltip')
    const { container, cleanup } = await renderInto(
      <TooltipProvider>
        <CommandPaletteTrigger onOpen={() => {}} />
      </TooltipProvider>
    )

    const button = container.querySelector('button[aria-label="Search"]')
    expect(button).not.toBeNull()
    expectPhoneTapTarget(button as Element)
    expect(button?.className).toContain('md:hidden')
    expect(button?.innerHTML).toContain('size-4')

    await cleanup()
  })
})

/**
 * Header time chips must be at least 44×44 on phones.
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

describe('GlobalTimeRangePicker', () => {
  test('each preset chip is a 44px tap target on phones', async () => {
    const { TimeRangeProvider } = await import(
      '@/lib/context/time-range-context'
    )
    const { GlobalTimeRangePicker } = await import('./time-range-picker')
    const { container, cleanup } = await renderInto(
      <TimeRangeProvider>
        <GlobalTimeRangePicker />
      </TimeRangeProvider>
    )

    const chips = container.querySelectorAll('[role="group"] button')
    expect(chips.length).toBeGreaterThanOrEqual(4)
    for (const chip of chips) {
      expect(chip.className).toContain('min-h-11')
      expect(chip.className).toContain('min-w-11')
    }

    await cleanup()
  })
})

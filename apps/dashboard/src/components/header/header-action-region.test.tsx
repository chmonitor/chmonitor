/**
 * The dashboard header has two explicit regions: the page identity stays on the
 * left, while the controls get a bounded, right-aligned responsive region.
 */

import type { ReactElement } from 'react'

import { HeaderActionRegion } from './header-action-region'
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

describe('HeaderActionRegion', () => {
  test('keeps controls right-aligned and bounded on every breakpoint', async () => {
    const { container, cleanup } = await renderInto(
      <HeaderActionRegion>
        <div data-testid="header-controls">controls</div>
      </HeaderActionRegion>
    )

    const region = container.querySelector(
      '[data-testid="dashboard-header-actions"]'
    )
    expect(region).not.toBeNull()

    const classes = region?.className.split(/\s+/) ?? []
    expect(classes).toContain('ml-auto')
    expect(classes).toContain('justify-end')
    expect(classes).toContain('min-w-0')
    expect(classes).toContain('max-w-full')
    expect(classes).toContain('overflow-x-auto')
    expect(classes).toContain('scrollbar-hide')
    expect(classes).toContain('w-full')
    expect(classes).toContain('basis-full')
    expect(classes).toContain('sm:w-auto')
    expect(classes).toContain('sm:flex-1')
    expect(classes).toContain('sm:shrink')
    expect(classes).not.toContain('sm:flex-none')
    expect(
      region?.contains(
        container.querySelector('[data-testid="header-controls"]')
      )
    ).toBe(true)

    await cleanup()
  })
})

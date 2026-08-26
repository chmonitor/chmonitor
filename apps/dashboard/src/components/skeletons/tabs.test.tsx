/**
 * Overview underline tab skeleton must match the scrollable strip so CLS
 * and 375 overflow stay in sync with overview.tsx.
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

describe('TabsSkeleton', () => {
  test('underline variant is a bounded overflow-x strip', async () => {
    const { TabsSkeleton } = await import('./tabs')
    const { container, cleanup } = await renderInto(
      <TabsSkeleton tabCount={7} variant="underline" />
    )

    const strip = container.querySelector('.overflow-x-auto')
    expect(strip).not.toBeNull()
    expect(strip?.className).toContain('min-w-0')
    expect(strip?.className).toContain('w-full')
    expect(strip?.className).toContain('scrollbar-hide')

    const list = strip?.firstElementChild
    expect(list?.className).toContain('w-max')
    expect(list?.className).toContain('min-w-full')
    expect(list?.className).toContain('flex-nowrap')

    await cleanup()
  })
})

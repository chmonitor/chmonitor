/**
 * Coarse pointers never hover. Collapse controls must rest visible
 * (opacity-40) and hide only under pointer-fine:opacity-0. A bare
 * opacity-0 token leaves them invisible on touch.
 */

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
import { createElement, type ReactElement } from 'react'

mock.module('./dynamic-chart', () => ({
  DynamicChart: () => null,
}))

// ChartChip calls useHostId, which needs a router. The Show pill is a sibling.
mock.module('./chart-chip', () => ({
  ChartChip: ({ label }: { label: string }) =>
    createElement('span', null, label),
}))

const { ChartRow } = await import('./chart-row')
const { CollapsedChartsRow } = await import('./collapsed-charts-row')

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

async function renderInto(node: ReactElement): Promise<HTMLDivElement> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return container
}

/** `pointer-fine:opacity-0` contains the letters opacity-0 but is not a bare token. */
function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean)
}

function expectTouchVisible(className: string) {
  const parts = tokens(className)
  expect(parts).not.toContain('opacity-0')
  expect(parts).toContain('opacity-40')
  expect(parts).toContain('pointer-fine:opacity-0')
  expect(className).toContain('pointer-fine:group-hover')
  expect(className).toContain('pointer-fine:group-focus-within')
}

describe('chart collapse controls on touch', () => {
  test('Show, Hide, and Expand rest visible and Hide grows on a coarse pointer', async () => {
    const collapsed = await renderInto(
      <ChartRow
        rowIndex={0}
        charts={['query-count']}
        isCollapsed
        onToggle={() => {}}
      />
    )
    const show = [...collapsed.querySelectorAll('span')].find((el) =>
      el.textContent?.includes('Show')
    )
    expect(show).toBeDefined()
    expectTouchVisible(show?.className ?? '')

    const expanded = await renderInto(
      <ChartRow
        rowIndex={0}
        charts={['query-count']}
        isCollapsed={false}
        onToggle={() => {}}
      />
    )
    const hide = expanded.querySelector('[aria-label="Collapse row"]')
    expect(hide).not.toBeNull()
    expectTouchVisible(hide?.className ?? '')
    expect(tokens(hide?.className ?? '')).toContain('pointer-coarse:size-9')

    const strip = await renderInto(
      <CollapsedChartsRow labels={['Queries']} onExpand={() => {}} />
    )
    const expand = [...strip.querySelectorAll('span')].find((el) =>
      el.textContent?.includes('Expand')
    )
    expect(expand).toBeDefined()
    expectTouchVisible(expand?.className ?? '')
  })
})

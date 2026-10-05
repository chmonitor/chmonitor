/**
 * Coarse pointers never hover. Collapse controls must rest visible
 * (opacity-40) and hide only under pointer-fine:opacity-0. A bare
 * opacity-0 token leaves them invisible on touch.
 *
 * happy-dom loads no stylesheet, so a media-query-conditioned opacity cannot be
 * read back here — the resting/reveal pair is asserted on class tokens, which is
 * the same contract `cards/chart-action-classes.test.ts` locks in. Everything
 * that IS observable from the DOM (an interactive, named, keyboard-operable
 * trigger, and a touch hit target wide enough for its own label) is asserted as
 * behaviour instead.
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

function labelPill(root: HTMLElement, text: string): HTMLSpanElement {
  const el = [...root.querySelectorAll('span')].find((node) =>
    node.textContent?.includes(text)
  )
  expect(el).toBeDefined()
  return el as HTMLSpanElement
}

async function press(el: HTMLElement, type: string, key: string) {
  const { act } = await import('react')
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }))
  })
}

describe('chart collapse controls on touch', () => {
  test('Show, Hide, and Expand rest visible instead of waiting for a hover', async () => {
    const collapsed = await renderInto(
      <ChartRow
        rowIndex={0}
        charts={['query-count']}
        isCollapsed
        onToggle={() => {}}
      />
    )
    expectTouchVisible(labelPill(collapsed, 'Show').className)

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

    const strip = await renderInto(
      <CollapsedChartsRow labels={['Queries']} onExpand={() => {}} />
    )
    expectTouchVisible(labelPill(strip, 'Expand').className)
  })

  // The Hide pill carries the word "Hide" plus a chevron. A coarse-pointer
  // width (pointer-coarse:size-9 / pointer-coarse:w-*) pins it narrower than
  // its own content, which pushes the icon and label outside the rounded
  // background and leaves the tappable area smaller than the desktop one.
  // Grow the height only and let the width follow the label, as the
  // date-range trigger does.
  test('Hide grows to a 36px tall touch target without pinning its width', async () => {
    const expanded = await renderInto(
      <ChartRow
        rowIndex={0}
        charts={['query-count']}
        isCollapsed={false}
        onToggle={() => {}}
      />
    )
    const parts = tokens(
      expanded.querySelector('[aria-label="Collapse row"]')?.className ?? ''
    )
    expect(parts).toContain('pointer-coarse:h-9')
    expect(parts.filter((t) => /^pointer-coarse:(size|w)-/.test(t))).toEqual([])
  })

  // The labels above are plain spans revealed by :hover / :focus-within on their
  // container, so they only exist for a user who can operate that container.
  // A focusable, named control that actually toggles is the behaviour that
  // makes them reachable.
  test('every collapse control is a focusable, named trigger that toggles', async () => {
    let collapsedToggles = 0
    const collapsed = await renderInto(
      <ChartRow
        rowIndex={0}
        charts={['query-count']}
        isCollapsed
        onToggle={() => {
          collapsedToggles += 1
        }}
      />
    )
    const rowTrigger = collapsed.querySelector(
      '[data-slot="collapsible-trigger"]'
    ) as HTMLElement
    expect(rowTrigger.getAttribute('role')).toBe('button')
    expect(rowTrigger.getAttribute('tabindex')).toBe('0')
    expect(rowTrigger.getAttribute('aria-expanded')).toBe('false')
    // The Show pill must sit inside the trigger, or :focus-within never reveals it.
    expect(rowTrigger.contains(labelPill(collapsed, 'Show'))).toBe(true)

    let expandedToggles = 0
    const expanded = await renderInto(
      <ChartRow
        rowIndex={0}
        charts={['query-count']}
        isCollapsed={false}
        onToggle={() => {
          expandedToggles += 1
        }}
      />
    )
    const hide = expanded.querySelector(
      '[aria-label="Collapse row"]'
    ) as HTMLButtonElement
    expect(hide.tagName).toBe('BUTTON')
    expect(hide.getAttribute('tabindex')).toBe('0')

    let expands = 0
    const strip = await renderInto(
      <CollapsedChartsRow
        labels={['Queries']}
        onExpand={() => {
          expands += 1
        }}
      />
    )
    const stripButton = strip.querySelector(
      '[aria-label="Expand charts"]'
    ) as HTMLButtonElement
    expect(stripButton.tagName).toBe('BUTTON')
    expect(stripButton.contains(labelPill(strip, 'Expand'))).toBe(true)

    const { act } = await import('react')
    const click = async (el: HTMLElement) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    // Mouse.
    await click(rowTrigger)
    await click(hide)
    await click(stripButton)
    expect([collapsedToggles, expandedToggles, expands]).toEqual([1, 1, 1])

    // Keyboard. Base UI clicks a non-native button on Enter keydown and on
    // Space keyup.
    await press(rowTrigger, 'keydown', 'Enter')
    await press(rowTrigger, 'keydown', ' ')
    await press(rowTrigger, 'keyup', ' ')
    expect(collapsedToggles).toBe(3)
  })
})

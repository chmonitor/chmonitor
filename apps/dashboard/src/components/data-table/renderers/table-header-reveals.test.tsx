/**
 * The data-table column-header controls — the drag grip
 * (`renderers/table-header.tsx`) and the column-options trigger
 * (`buttons/column-header-dropdown.tsx`) — must stay visible on a coarse
 * pointer (#3668). Touch has no hover, and Tailwind v4 wraps a bare `hover:` in
 * `@media (hover: hover)`, so a resting `opacity-0` revealed only by
 * `group-hover` / `focus-visible` leaves the control present, focusable, and
 * invisible on every touch device.
 *
 * The contract is the one `cards/chart-action-classes.ts` already ships: rest at
 * `opacity-40`, hide only under `pointer-fine:opacity-0`, reveal on
 * `pointer-fine:group-hover` / `pointer-fine:group-focus-within`.
 *
 * Both controls are rendered from their real start state and read back out of
 * the DOM. happy-dom loads no stylesheet, so a media-query-conditioned opacity
 * cannot be observed — the resting/reveal pair is asserted on class tokens,
 * which is the same contract `layout/query-page/chart-collapse-touch.test.tsx`
 * locks in. Everything that IS observable from the DOM is asserted as
 * behaviour: a focusable, named control that opens the menu.
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

// Base UI captures `document` on first import, so the components under test are
// loaded AFTER the registrator is installed (same reason
// nav-main/row-actions-menu.test.tsx imports inside the test).
let ColumnHeaderDropdown: typeof import('../buttons/column-header-dropdown').ColumnHeaderDropdown
let TableHeaderRow: typeof import('./table-header').TableHeaderRow
let DndContext: typeof import('@dnd-kit/core').DndContext

beforeAll(async () => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }

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

  ;({ ColumnHeaderDropdown } = await import(
    '../buttons/column-header-dropdown'
  ))
  ;({ TableHeaderRow } = await import('./table-header'))
  ;({ DndContext } = await import('@dnd-kit/core'))
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

// ---------------------------------------------------------------------------
// Minimal TanStack Table stand-ins. Only the accessors the two components call
// are implemented, so the assertion reads the shipped component rather than a
// reimplementation of it.
// ---------------------------------------------------------------------------

let sorted: false | 'asc' | 'desc' = false

function makeHeader(id: string) {
  const column = {
    id,
    columnDef: { header: id, minSize: 50, maxSize: 500 },
    getSize: () => 120,
    getCanSort: () => true,
    getIsSorted: () => sorted,
    getCanResize: () => false,
    getIsResizing: () => false,
    getIsPlaceholder: () => false,
    resetSize: () => {},
    toggleSorting: (desc?: boolean) => {
      sorted = desc ? 'desc' : 'asc'
    },
    clearSorting: () => {
      sorted = false
    },
  }
  const header = {
    id: `header_${id}`,
    column,
    colSpan: 1,
    isPlaceholder: false,
    subHeaders: [],
    getContext: () => ({ table: { id: 'test' } }),
    getResizeHandler: () => () => {},
  }
  return header as unknown as Parameters<
    typeof ColumnHeaderDropdown
  >[0]['header']
}

async function renderDropdown(id = 'query_duration_ms') {
  return renderInto(<ColumnHeaderDropdown header={makeHeader(id)} />)
}

async function renderHeaderRow() {
  const header = makeHeader('query')
  return renderInto(
    <DndContext>
      <table>
        <thead>
          <TableHeaderRow headers={[header] as never} enableColumnReordering />
        </thead>
      </table>
    </DndContext>
  )
}

/**
 * The resting/reveal contract. A bare `opacity-0` is the bug: it hides the
 * control from every pointer, and only the hover/focus pair brings it back.
 * `pointer-fine:opacity-0` is a different token and must not satisfy this.
 */
function expectTouchVisible(el: Element | null, label: string) {
  expect(el, `${label} is rendered`).not.toBeNull()
  const parts = tokens(el?.getAttribute('class') ?? '')

  expect(parts, `${label} has no bare opacity-0`).not.toContain('opacity-0')
  expect(parts, `${label} rests visible`).toContain('opacity-40')
  expect(parts, `${label} hides only for a fine pointer`).toContain(
    'pointer-fine:opacity-0'
  )
  expect(parts, `${label} reveals on fine-pointer group hover`).toContain(
    'pointer-fine:group-hover:opacity-40'
  )
  expect(parts, `${label} reveals on fine-pointer focus-within`).toContain(
    'pointer-fine:group-focus-within:opacity-40'
  )
}

function control(root: HTMLElement, label: string): HTMLElement {
  const el = root.querySelector(`[aria-label="${label}"]`)
  expect(el, `${label} is rendered`).not.toBeNull()
  return el as HTMLElement
}

describe('data-table column-header controls on touch', () => {
  test('the column-options trigger rests visible instead of waiting for a hover', async () => {
    const root = await renderDropdown()
    expectTouchVisible(
      control(root, 'Column options for query_duration_ms'),
      'column-options trigger'
    )
  })

  test('the drag grip rests visible instead of waiting for a hover', async () => {
    const root = await renderHeaderRow()
    expectTouchVisible(
      control(root, 'Drag to reorder query column'),
      'drag grip'
    )
  })

  // Both are icon-only round-ish targets, so `size-9` is the right coarse-pointer
  // size (the documented rule: `h-9` for a labelled pill, `size-9` for an
  // icon-only button). Neither may pin a width that clips its own icon.
  test('both controls grow to a 36px hit target on a coarse pointer', async () => {
    const trigger = control(
      await renderDropdown(),
      'Column options for query_duration_ms'
    )
    const grip = control(
      await renderHeaderRow(),
      'Drag to reorder query column'
    )

    for (const [el, name] of [
      [trigger, 'column-options trigger'],
      [grip, 'drag grip'],
    ] as const) {
      const parts = tokens(el.getAttribute('class') ?? '')
      // Icon-only, so a square size is correct — but a width-only or min-width
      // rule would shrink the box and clip the glyph inside it.
      expect(el.textContent?.trim() ?? '', `${name} is icon-only`).toBe('')
      expect(parts, `${name} grows on touch`).toContain('pointer-coarse:size-9')
      expect(
        parts.filter((t) => /^pointer-coarse:(w|min-w)-/.test(t)),
        `${name} pins no coarse width`
      ).toEqual([])
    }
  })

  // The grip is absolutely positioned over the header cell, and the label sits
  // in a sibling wrapper with a left gutter. A 36px grip in the mouse-size 28px
  // gutter would land on top of the column name (#3641 caught this shape on a
  // labelled pill), so the gutter has to widen with the grip.
  test('the grip gutter widens on touch so the handle clears the column label', async () => {
    const root = await renderHeaderRow()
    const grip = control(root, 'Drag to reorder query column')
    const gripParts = tokens(grip.getAttribute('class') ?? '')
    const size = gripParts.find((t) => /^pointer-coarse:size-(\d+)$/.test(t))
    const coarseSize = Number(size?.split('-').pop())

    const label = root.querySelector('span')
    const gutter = label?.parentElement?.parentElement
    const gutterParts = tokens(gutter?.getAttribute('class') ?? '')
    const pad = gutterParts.find((t) => /^pointer-coarse:pl-(\d+)$/.test(t))
    const coarsePad = Number(pad?.split('-').pop())

    expect(coarseSize, 'grip has a coarse-pointer size').toBeGreaterThan(0)
    expect(
      coarsePad,
      'label gutter has a coarse-pointer padding'
    ).toBeGreaterThan(0)
    expect(
      coarsePad,
      'gutter is at least as wide as the grip'
    ).toBeGreaterThanOrEqual(coarseSize)
  })

  // WCAG 2.5.3 Label in Name only constrains a control that has visible text;
  // both of these are icon-only, so the contract that matters is that each has
  // an accessible name a screen reader can announce, and that the name names
  // the column it acts on.
  test('each control has an accessible name that identifies its column', async () => {
    const trigger = control(
      await renderDropdown('memory_usage'),
      'Column options for memory_usage'
    )
    const grip = control(
      await renderHeaderRow(),
      'Drag to reorder query column'
    )

    for (const [el, name] of [
      [trigger, 'Column options for memory_usage'],
      [grip, 'Drag to reorder query column'],
    ] as const) {
      expect(el.getAttribute('aria-label')).toBe(name)
      // Icon-only: no visible text to fold into the name, and no text node that
      // could contradict the label.
      expect(el.textContent?.trim() ?? '').toBe('')
    }
  })

  test('each control is a focusable button', async () => {
    const trigger = control(
      await renderDropdown(),
      'Column options for query_duration_ms'
    )
    const grip = control(
      await renderHeaderRow(),
      'Drag to reorder query column'
    )

    for (const [el, name] of [
      [trigger, 'column-options trigger'],
      [grip, 'drag grip'],
    ] as const) {
      expect(el.tagName, `${name} is a button`).toBe('BUTTON')
      expect(el.getAttribute('type'), `${name} is not a submit button`).toBe(
        'button'
      )
      expect(el.hasAttribute('disabled'), `${name} is enabled`).toBe(false)
      // Not `hidden`, `sr-only`, or `display:none` — a hover-revealed control
      // that is removed from the a11y tree cannot be reached at all.
      expect(el.getAttribute('aria-hidden')).toBeNull()
      expect(el.closest('[hidden]')).toBeNull()
    }
  })

  // A native <button> is Enter/Space operable by definition; `aria-haspopup` is
  // what tells a screen reader the activation opens a menu. Asserting the menu
  // really opens proves the reveal contract has something to reveal: Base UI
  // puts `data-popup-open` on the trigger while it is open, and the resting
  // fine-pointer state is `opacity-0`.
  test('the trigger announces its menu and really opens one', async () => {
    const { act } = await import('react')
    const root = await renderDropdown()
    const trigger = control(root, 'Column options for query_duration_ms')

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(tokens(trigger.getAttribute('class') ?? '')).toContain(
      'data-popup-open:!opacity-100'
    )

    await act(async () => {
      trigger.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(trigger.getAttribute('data-popup-open'), 'trigger marked open').toBe(
      ''
    )
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).map((el) => el.textContent?.trim())
    expect(items).toContain('Reset sort')
    expect(items).toContain('Copy name')
  })

  test('a click on the grip does not toggle the sort', async () => {
    const { act } = await import('react')
    sorted = false
    const root = await renderHeaderRow()
    const grip = control(root, 'Drag to reorder query column')

    await act(async () => {
      grip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(sorted, 'the grip stops the click so it cannot drag-sort').toBe(
      false
    )
  })
})

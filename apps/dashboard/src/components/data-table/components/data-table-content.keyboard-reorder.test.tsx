/**
 * Column reordering must be operable by keyboard (#3671).
 *
 * WHY this file exists
 * --------------------
 * `DataTableContent` registered only a `PointerSensor`, while the grip in
 * `renderers/table-header.tsx` spreads dnd-kit's `attributes` onto a real
 * `<button>`. That gave the grip `role="button"`,
 * `aria-roledescription="sortable"`, `tabIndex=0`, and — the damning part —
 * `aria-describedby` pointing at dnd-kit's own hidden "To pick up a draggable
 * item, press the space bar" text. A screen-reader user was told a control
 * existed, was told which key operated it, and pressing it did nothing:
 * WCAG 2.1.1 (Keyboard), level A.
 *
 * These tests drive the REAL keyboard interaction end to end — focus the grip,
 * Space to pick up, arrow to move, Space to drop — and assert the rendered
 * column order actually changed. Asserting that a `KeyboardSensor` is
 * *registered* is a proxy: the bug was precisely a control that looked correct
 * and did nothing, so the behaviour is the only thing worth asserting.
 *
 * Pointer dragging is covered too. The keyboard sensor is additive, and
 * "additive" is only worth anything if the pointer path still works: a mouse
 * drag reorders, and a bare click still does NOT start a drag (the PointerSensor
 * keeps its 8px activation distance — see #3670).
 *
 * happy-dom runs no layout, so each `<th>` is given a real horizontal box. That
 * is the geometry a browser supplies for free and dnd-kit's
 * `sortableKeyboardCoordinates` needs in order to know which column an arrow key
 * moves to. Nothing about the component's own behaviour is stubbed.
 */

import type { ColumnDef, ColumnOrderState } from '@tanstack/react-table'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'

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
import { useState } from 'react'

// Base UI and dnd-kit capture `document`/`window` on first import, so the
// component under test is imported AFTER the registrator is installed (same
// reason renderers/table-header-reveals.test.tsx does this).
let DataTableContent: typeof import('./data-table-content').DataTableContent

/** Fake width of one header cell, so the stubbed geometry spans three columns. */
const COLUMN_WIDTH = 120

beforeAll(async () => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }

  // happy-dom runs no layout, so every box is 0x0 at the origin and dnd-kit
  // cannot tell one column from another. `sortableKeyboardCoordinates` reads
  // those boxes to decide which column an arrow key moves to, and a real drop
  // REMOUNTS the table (DataTableContent keys its <Table> on the column order),
  // so the geometry has to survive the rebuild. Patching the prototype rather
  // than individual nodes is what makes it survive.
  const realRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    if (this.tagName === 'TH') {
      const siblings = this.parentElement?.children ?? []
      const index = Array.prototype.indexOf.call(siblings, this)
      const left = index * COLUMN_WIDTH
      return {
        x: left,
        y: 0,
        left,
        top: 0,
        right: left + COLUMN_WIDTH,
        bottom: 40,
        width: COLUMN_WIDTH,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect
    }
    return realRect.call(this)
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

  ;({ DataTableContent } = await import('./data-table-content'))
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Row {
  alpha: string
  bravo: string
  charlie: string
}

const COLUMN_DEFS: ColumnDef<Row>[] = [
  { accessorKey: 'alpha', header: 'Alpha', enableSorting: true },
  { accessorKey: 'bravo', header: 'Bravo', enableSorting: true },
  { accessorKey: 'charlie', header: 'Charlie', enableSorting: true },
]

const ROWS: Row[] = [{ alpha: '1', bravo: '2', charlie: '3' }]

const INITIAL_ORDER: ColumnOrderState = ['alpha', 'bravo', 'charlie']

/**
 * Mirrors `useDataTableInstance`: `columnOrder` is CONTROLLED state. That is what
 * makes `DataTableContent`'s `<Table key={columnOrder.join(',')}>` remount on a
 * drop, which is what dnd-kit's focus restore has to survive.
 */
function Harness({
  onReorder,
}: {
  onReorder: (active: string, over: string) => void
}) {
  const [columnOrder, setColumnOrder] =
    useState<ColumnOrderState>(INITIAL_ORDER)

  const move = (active: string, over: string) => {
    const from = columnOrder.indexOf(active)
    const to = columnOrder.indexOf(over)
    const next = [...columnOrder]
    next.splice(to, 0, next.splice(from, 1)[0])
    setColumnOrder(next)
    onReorder(active, over)
  }

  const table = useReactTable({
    data: ROWS,
    columns: COLUMN_DEFS,
    getCoreRowModel: getCoreRowModel(),
    state: { columnOrder },
  })

  return (
    <DataTableContent<Row, React.ReactNode>
      title="Reorder"
      description="column reorder fixture"
      queryConfig={{ name: 'reorder', columns: [] } as never}
      table={table}
      columnDefs={COLUMN_DEFS as never}
      tableContainerRef={{ current: null }}
      isVirtualized={false}
      virtualizer={null as never}
      activeFilterCount={0}
      enableColumnReordering
      onColumnOrderChange={move}
      view="table"
    />
  )
}

type Act = typeof import('react').act

async function render(node: ReactElement): Promise<HTMLDivElement> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  // Rendered twice so the draggable nodes are measured after they mount.
  await act(async () => {
    root.render(node)
  })
  await act(async () => {
    root.render(node)
  })

  return container
}

/** Let dnd-kit's timers, its measuring pass, and its rAF focus restore settle. */
async function settle(act: Act) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

async function pressKey(el: Element, code: string, act: Act) {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        code,
        key: code === 'Space' ? ' ' : code,
        bubbles: true,
        cancelable: true,
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function pressPointer(
  target: EventTarget,
  type: string,
  clientX: number,
  act: Act
) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX,
        clientY: 10,
        bubbles: true,
        cancelable: true,
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

// ---------------------------------------------------------------------------
// Read the shipped DOM
// ---------------------------------------------------------------------------

/** Grip labels in rendered (visual) order — what the user actually sees. */
function renderedOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button[aria-label^="Drag to reorder"]'
    )
  ).map((el) => {
    const label = el.getAttribute('aria-label') ?? ''
    return label.replace('Drag to reorder ', '').replace(' column', '')
  })
}

function grip(container: HTMLElement, column: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `[aria-label="Drag to reorder ${column} column"]`
  )
  expect(el, `grip for ${column} is rendered`).not.toBeNull()
  return el as HTMLElement
}

function liveRegionText(): string {
  return document.querySelector('[aria-live]')?.textContent?.trim() ?? ''
}

async function mount() {
  const { act } = await import('react')
  const reorders: [string, string][] = []
  const container = await render(
    <Harness onReorder={(active, over) => reorders.push([active, over])} />
  )
  return { act, container, reorders }
}

// ---------------------------------------------------------------------------

describe('data-table column reorder by keyboard', () => {
  test('Space picks the column up, an arrow moves it, Space drops it in the new position', async () => {
    const { act, container, reorders } = await mount()

    expect(renderedOrder(container)).toEqual(['alpha', 'bravo', 'charlie'])

    const handle = grip(container, 'alpha')
    handle.focus()
    expect(document.activeElement).toBe(handle)

    await pressKey(handle, 'Space', act)
    await pressKey(handle, 'ArrowRight', act)
    await pressKey(handle, 'Space', act)
    await settle(act)

    // The drop reached the reorder callback...
    expect(reorders).toEqual([['alpha', 'bravo']])
    // ...and the rendered order really changed.
    expect(renderedOrder(container)).toEqual(['bravo', 'alpha', 'charlie'])
  })

  test('Enter picks up and drops too, so both keys the instructions name work', async () => {
    const { act, container, reorders } = await mount()

    const handle = grip(container, 'charlie')
    handle.focus()

    await pressKey(handle, 'Enter', act)
    await pressKey(handle, 'ArrowLeft', act)
    await pressKey(handle, 'Enter', act)
    await settle(act)

    expect(reorders).toEqual([['charlie', 'bravo']])
    expect(renderedOrder(container)).toEqual(['alpha', 'charlie', 'bravo'])
  })

  test('a keyboard reorder can be repeated, so focus has to come back to the moved grip', async () => {
    const { act, container, reorders } = await mount()

    // The drop changes `columnOrder`, and DataTableContent keys its <Table> on
    // that order — so the whole table subtree is torn down and rebuilt and the
    // grip that had focus is destroyed. dnd-kit restores focus on the rebuilt
    // grip; without that, a second reorder would be impossible because focus
    // would be on <body>.
    const first = grip(container, 'alpha')
    first.focus()
    await pressKey(first, 'Space', act)
    await pressKey(first, 'ArrowRight', act)
    await pressKey(first, 'Space', act)
    await settle(act)

    const landed = document.activeElement as HTMLElement | null
    expect(
      landed?.getAttribute('aria-label'),
      'focus lands on the rebuilt grip of the moved column'
    ).toBe('Drag to reorder alpha column')
    expect(landed?.isConnected, 'that grip is in the document').toBe(true)

    // And it is still operable, so the second move goes through too.
    const second = grip(container, 'alpha')
    second.focus()
    await pressKey(second, 'Space', act)
    await pressKey(second, 'ArrowRight', act)
    await pressKey(second, 'Space', act)
    await settle(act)

    expect(reorders).toEqual([
      ['alpha', 'bravo'],
      ['alpha', 'charlie'],
    ])
    expect(renderedOrder(container)).toEqual(['bravo', 'charlie', 'alpha'])
  })

  test('Escape cancels the reorder and the order is untouched', async () => {
    const { act, container, reorders } = await mount()

    const handle = grip(container, 'alpha')
    handle.focus()
    await pressKey(handle, 'Space', act)
    await pressKey(handle, 'ArrowRight', act)
    await pressKey(handle, 'Escape', act)
    await settle(act)

    expect(reorders).toEqual([])
    expect(renderedOrder(container)).toEqual(['alpha', 'bravo', 'charlie'])
  })
})

describe('what a screen reader is told during a keyboard reorder', () => {
  test('dnd-kit renders a live region for the announcements', async () => {
    const { act, container } = await mount()
    const handle = grip(container, 'alpha')
    handle.focus()

    await pressKey(handle, 'Space', act)

    const region = document.querySelector('[aria-live]')
    expect(region, 'a live region exists').not.toBeNull()
    expect(region?.getAttribute('role')).toBe('status')
  })

  test('pick-up, move, and drop each name the column and its position', async () => {
    const { act, container } = await mount()
    const handle = grip(container, 'alpha')
    handle.focus()

    await pressKey(handle, 'Space', act)
    const pickedUp = liveRegionText()
    // Names the column, and — this is the message that must not be clobbered —
    // states which keys move it.
    expect(pickedUp).toContain('alpha column')
    expect(pickedUp).toMatch(/arrow keys/i)

    await pressKey(handle, 'ArrowRight', act)
    const moved = liveRegionText()
    expect(moved).toContain('alpha column')
    expect(moved).toContain('position 2 of 3')

    await pressKey(handle, 'Space', act)
    const dropped = liveRegionText()
    expect(dropped).toContain('alpha column')
    expect(dropped).toContain('position 2 of 3')
  })

  test('the pick-up instructions survive the drag starting', async () => {
    const { act, container } = await mount()
    const handle = grip(container, 'alpha')
    handle.focus()

    await pressKey(handle, 'Space', act)
    await settle(act)

    // dnd-kit fires `onDragOver` the instant the drag starts, while the column
    // is still over itself. Announcing that would replace the only statement of
    // which keys move the column before a screen reader could read it.
    expect(liveRegionText()).toMatch(/arrow keys/i)
  })

  test('cancelling is announced as a cancellation, not a drop', async () => {
    const { act, container } = await mount()
    const handle = grip(container, 'alpha')
    handle.focus()

    await pressKey(handle, 'Space', act)
    await pressKey(handle, 'ArrowRight', act)
    await pressKey(handle, 'Escape', act)
    await settle(act)

    expect(liveRegionText()).toMatch(/cancel/i)
    expect(liveRegionText()).toContain('alpha column')
  })
})

describe('pointer reordering still works (the keyboard sensor is additive)', () => {
  test('a mouse drag reorders the columns', async () => {
    const { act, container, reorders } = await mount()

    const handle = grip(container, 'alpha')
    await pressPointer(handle, 'pointerdown', 0, act)
    // dnd-kit binds its move/end listeners to the activator node itself
    // (getEventListenerTarget), so these go on the grip, not the document. The
    // FIRST move only trips the 8px activation distance and returns without
    // moving anything, so a second one is what actually carries the column.
    await pressPointer(handle, 'pointermove', 200, act)
    await pressPointer(handle, 'pointermove', 260, act)
    await pressPointer(handle, 'pointerup', 260, act)
    await settle(act)

    expect(reorders.length).toBe(1)
    expect(reorders[0][0]).toBe('alpha')
    expect(reorders[0][1]).not.toBe('alpha')
    expect(renderedOrder(container)).not.toEqual(['alpha', 'bravo', 'charlie'])
  })

  // #3670 rests on the PointerSensor's activation distance: a click on the grip
  // must not be read as the start of a drag. A KeyboardSensor must not erode it.
  test('a bare click still does not start a drag', async () => {
    const { act, container, reorders } = await mount()

    const handle = grip(container, 'alpha')
    await pressPointer(handle, 'pointerdown', 0, act)
    await pressPointer(handle, 'pointerup', 2, act)
    await settle(act)

    expect(reorders).toEqual([])
    expect(renderedOrder(container)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  test('the grip keeps the touch hit target and inline touch-action from #3670', async () => {
    const { container } = await mount()
    const handle = grip(container, 'alpha')

    const tokens = (handle.getAttribute('class') ?? '').split(/\s+/)
    expect(tokens).toContain('pointer-coarse:size-9')
    expect(
      (handle.getAttribute('style') ?? '').replace(/\s/g, ''),
      'touchAction stays none so a finger drag is not stolen by the scroller'
    ).toContain('touch-action:none')
  })
})

/**
 * The sidebar resize grip must be visible to every input mode (#3668).
 *
 * It rested at `opacity-0` and was revealed by `group-hover:opacity-100` /
 * `group-focus-visible:opacity-100`. Tailwind v4 wraps a bare `hover:` in
 * `@media (hover: hover)`, so on a coarse pointer the resting opacity was never
 * raised: a keyboard-operable `role="separator"` with a focus ring and a drag
 * surface that no touch user could see.
 *
 * Two details this file pins:
 *
 * 1. The focusable element is the PARENT separator, so every reveal has to be a
 *    `group-` variant. A bare `focus-visible:` on the grip could never match.
 * 2. `isResizing` used to win with a plain `opacity-100`. That no longer works:
 *    `pointer-fine:opacity-0` is emitted LATER in the compiled sheet with the same
 *    specificity, so on a mouse it would have beat the resize feedback and the grip
 *    would vanish mid-drag. The state now also carries `hover:!opacity-100`.
 *
 * happy-dom loads no stylesheet, so the media-query-conditioned opacity itself
 * cannot be read back here — see `mcp-reveals.test.tsx` for the same limitation.
 * The class contract is asserted on tokens, and the reachability that makes the
 * reveal meaningful is asserted as DOM behaviour.
 */

import type { ReactElement } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

let sidebarState = 'expanded'
const openCalls: boolean[] = []

// The real SidebarProvider needs a router and a cookie store; the handle under
// test only reads `useSidebar()`.
mock.module('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children?: ReactElement }) => children,
  useSidebar: () => ({
    state: sidebarState,
    setOpen: (open: boolean) => {
      openCalls.push(open)
    },
  }),
}))

const { ResizableSidebarProvider } = await import(
  './resizable-sidebar-provider'
)

const SOURCE = readFileSync(
  fileURLToPath(new URL('./resizable-sidebar-provider.tsx', import.meta.url)),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

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
  sidebarState = 'expanded'
  openCalls.length = 0
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

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean)
}

function separator(root: HTMLElement): HTMLElement {
  const el = root.querySelector('[role="separator"]') as HTMLElement
  expect(el).not.toBeNull()
  return el
}

function grip(root: HTMLElement): HTMLElement {
  const el = separator(root).firstElementChild as HTMLElement
  expect(el).not.toBeNull()
  return el
}

describe('sidebar resize grip visibility', () => {
  test('rests visible on touch and hides only where a hover exists', async () => {
    const root = await renderInto(
      <ResizableSidebarProvider>
        <div>content</div>
      </ResizableSidebarProvider>
    )
    const parts = tokens(grip(root).className)

    expect(parts).not.toContain('opacity-0')
    // The only opacity-0 allowed is the guarded fine-pointer variant.
    expect(parts.filter((t) => t.endsWith('opacity-0'))).toEqual([
      'pointer-fine:opacity-0',
    ])
    expect(parts).toContain('opacity-40')
    expect(parts).toContain('pointer-fine:group-hover:opacity-40')
    expect(parts).toContain('pointer-fine:group-focus-within:opacity-40')
    // `!` or the reveal ties on specificity with the hold-down and loses on order.
    expect(parts).toContain('group-hover:!opacity-100')
    expect(parts).toContain('group-focus-within:!opacity-100')
    // A bare `focus-visible:` here could never match: the grip is not focusable.
    expect(parts.filter((t) => /(^|:)focus-visible:!opacity/.test(t))).toEqual(
      []
    )
  })

  // The reveal has to hang off an ancestor that actually carries `group`.
  test('the grip sits inside the group it reveals off of', async () => {
    const root = await renderInto(
      <ResizableSidebarProvider>
        <div>content</div>
      </ResizableSidebarProvider>
    )
    const handle = separator(root)
    expect(tokens(handle.className)).toContain('group')
    expect(handle.contains(grip(root))).toBe(true)
  })

  // `pointer-fine:opacity-0` is emitted after a plain `opacity-100` with equal
  // specificity, so the old `isResizing && 'opacity-100'` would have lost on a
  // mouse and the grip would disappear mid-drag.
  test('the resize state still forces the grip visible', () => {
    expect(SOURCE).toContain("isResizing && 'opacity-100 hover:!opacity-100'")
  })

  // The handle is the drag surface: 16px is a thin finger target on a tablet in
  // landscape, which is exactly where the `lg:` handle is reachable at all.
  test('the drag surface grows for a finger', async () => {
    const root = await renderInto(
      <ResizableSidebarProvider>
        <div>content</div>
      </ResizableSidebarProvider>
    )
    const parts = tokens(separator(root).className)
    expect(parts).toContain('w-4')
    expect(parts).toContain('pointer-coarse:w-6')
  })

  test('is a focusable, named separator that resizes with the keyboard', async () => {
    const root = await renderInto(
      <ResizableSidebarProvider>
        <div>content</div>
      </ResizableSidebarProvider>
    )
    const handle = separator(root)

    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.getAttribute('aria-label')).toBe('Resize sidebar')
    expect(handle.getAttribute('tabindex')).toBe('0')
    expect(handle.getAttribute('aria-valuenow')).toBeTruthy()

    const { act } = await import('react')
    await act(async () => {
      handle.focus()
    })
    expect(document.activeElement).toBe(handle)

    // `applyWidth` reads the wrapper the real SidebarProvider renders; the mock
    // above does not, so stand one in.
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-slot', 'sidebar-wrapper')
    document.body.appendChild(wrapper)

    const press = async (key: string, shiftKey = false) => {
      await act(async () => {
        handle.dispatchEvent(
          new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })
        )
      })
    }

    // Focus is on the separator, so the grip's group-focus-within reveal fires.
    const start = handle.getAttribute('aria-valuenow')
    await press('ArrowRight')
    expect(handle.getAttribute('aria-valuenow')).not.toBe(start)

    // End / Home reach the declared bounds.
    await press('End')
    expect(handle.getAttribute('aria-valuenow')).toBe(
      handle.getAttribute('aria-valuemax')
    )
    await press('Home')
    expect(handle.getAttribute('aria-valuenow')).toBe(
      handle.getAttribute('aria-valuemin')
    )

    // Arrowing left past the collapse threshold collapses the sidebar.
    await press('ArrowLeft')
    expect(openCalls).toContain(false)
  })
})

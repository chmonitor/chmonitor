/**
 * The readonly-tables warning must be visible to every input mode (#3668).
 *
 * It used to be gated behind `alwaysVisible || isOpen ? 'opacity-100' :
 * 'opacity-0 group-hover:opacity-100'`. That ternary is not a pointer branch —
 * it is a prop plus the popover's open state — and the `opacity-0` arm could
 * never have rendered a working control:
 *
 *   - `alwaysVisible` defaulted to `true` and the only caller never passed it,
 *     so the `opacity-0` arm was dead code.
 *   - the reveal selector was inert anyway: `group-hover:` needs an ancestor
 *     carrying `group`, and on `clusters/replicas-status` this button is a
 *     SIBLING of the table card inside a bare `<div className="flex flex-col
 *     gap-4">`. The `group` classes in `tables/table-client.tsx` are on those
 *     sibling cards.
 *   - there was no `focus-visible` / `group-focus-within` restore either, so
 *     the arm hid the control from keyboard and screen-reader users too.
 *
 * So the defect was latent rather than rendered: the first caller to pass
 * `alwaysVisible={false}` would have shipped a readonly-table health signal that
 * no input mode could see. The fix removes the gate instead of re-arming it
 * under `pointer-fine:`, because a "N tables are readonly" warning is a signal,
 * not a chart action to declutter.
 *
 * The visible label was `3readonly` — `gap-1.5` spaces the boxes but no text
 * node joined them, so the accessible name ("3 readonly tables - click for
 * details") did not contain the visible text. That is a WCAG 2.5.3 failure on
 * its own; the label now renders as "3 readonly".
 *
 * happy-dom loads no stylesheet, so a media-query-conditioned opacity cannot be
 * read back here — the same limitation `chart-collapse-touch.test.tsx` and
 * `copy-button-touch.test.tsx` document. This asserts the class contract plus
 * everything the DOM can prove: a focusable, named, keyboard-reachable trigger
 * whose accessible name contains its visible text (WCAG 2.5.3).
 *
 * Opening the floating popover is deliberately not asserted: no test in this
 * repo drives a Base UI overlay open under happy-dom, and the panel is not part
 * of the visibility contract.
 */

import type { ReactElement, ReactNode } from 'react'

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

// The data hook and the router link need a query client / router context;
// neither exists outside one, and neither is what this file is about.
let readonlyCount: number | null = 3
mock.module('@/lib/swr/use-cluster-count', () => ({
  useClusterCount: () => ({
    count: readonlyCount,
    isLoading: false,
    error: undefined,
    refresh: () => {},
  }),
}))
mock.module('@/components/ui/app-link', () => ({
  AppLink: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const { ReadonlyTablesWarning } = await import('./readonly-tables-warning')

const SOURCE = readFileSync(
  fileURLToPath(new URL('./readonly-tables-warning.tsx', import.meta.url)),
  'utf8'
)

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  readonlyCount = 3
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

function trigger(root: HTMLElement): HTMLButtonElement {
  // Base UI's `render` merge gives the trigger its own data-slot.
  const el = root.querySelector('[data-slot="popover-trigger"]')
  expect(el).not.toBeNull()
  return el as HTMLButtonElement
}

describe('readonly-tables warning visibility', () => {
  test('rests visible with no hover or focus reveal to find it by', async () => {
    const root = await renderInto(
      <ReadonlyTablesWarning hostId={0} cluster="prod" />
    )
    const parts = tokens(trigger(root).className)

    // `pointer-fine:opacity-0` contains the letters opacity-0 but is a different
    // token; match every variant so a re-guarded gate still fails here.
    expect(parts.filter((t) => /(^|:)opacity-0$/.test(t))).toEqual([])

    // There is no reveal at all: nothing to wait for on touch, and no
    // focus-visible restore to miss at any pointer type.
    expect(
      parts.filter((t) => /(hover|focus-within|focus-visible):opacity/.test(t))
    ).toEqual([])

    // The warning still reads as a warning, from a semantic token.
    expect(parts).toContain('text-destructive')
    expect(parts.join(' ')).not.toMatch(/(#[0-9a-f]{3,8}|oklch\(|rgb\()/i)
  })

  // The rendered className cannot catch a gate in an unreachable arm, and the
  // old `opacity-0` arm was unreachable by construction. Scan the source so a
  // re-added dead arm fails here instead of shipping to the first caller who
  // passes the flag.
  test('no opacity gate exists in the source at all', () => {
    expect(SOURCE).not.toMatch(/opacity-0/)
    expect(SOURCE).not.toMatch(/(hover|focus-within|focus-visible):opacity/)
  })

  test('is a focusable, named control wired to the detail popover', async () => {
    const root = await renderInto(
      <ReadonlyTablesWarning hostId={0} cluster="prod" />
    )
    const button = trigger(root)

    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('tabindex')).toBe('0')
    expect(button.getAttribute('aria-label')).toBeTruthy()
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // Base UI registered this element as the popover's click trigger, so it is
    // operable rather than decorative.
    expect(button.hasAttribute('data-base-ui-click-trigger')).toBe(true)

    // Reachable by keyboard: focus lands on the control itself, not a wrapper.
    const { act } = await import('react')
    await act(async () => {
      button.focus()
    })
    expect(document.activeElement).toBe(button)
  })

  // WCAG 2.5.3 Label in Name: the accessible name must contain the visible
  // text, so voice control saying "readonly" still hits this button. The
  // spans carry no whitespace between them, so this fails unless the rendered
  // text really is "3 readonly".
  test('accessible name contains the visible text (WCAG 2.5.3)', async () => {
    for (const count of [1, 3]) {
      readonlyCount = count
      const root = await renderInto(
        <ReadonlyTablesWarning hostId={0} cluster="prod" />
      )
      const button = trigger(root)

      const visible = (button.textContent ?? '').replace(/\s+/g, ' ').trim()
      expect(visible).toBe(`${count} readonly`)

      // aria-label wins the accessible-name computation over the contents.
      const name = button.getAttribute('aria-label') ?? ''
      expect(name).toContain(visible)

      document.body.replaceChildren()
    }
  })

  // The destructive signal stays out of the way when the cluster is healthy.
  test('renders nothing when there are no readonly tables', async () => {
    readonlyCount = 0
    const root = await renderInto(
      <ReadonlyTablesWarning hostId={0} cluster="prod" />
    )
    expect(root.querySelector('[data-slot="popover-trigger"]')).toBeNull()
  })
})

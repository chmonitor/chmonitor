/**
 * MCP page controls must be reachable without a hover (#3668).
 *
 * Two shapes, two reasons:
 *
 * - `CodeBlock`'s copy button is the ONLY way to copy a snippet (no context menu,
 *   no selection handler). It rested at `opacity-0` behind
 *   `group-hover:opacity-100`, and Tailwind v4 wraps a bare `hover:` in
 *   `@media (hover: hover)` — so on a coarse pointer the button was present,
 *   focusable and invisible. Permanent, no gate.
 * - `McpExamplePrompts`' copy icon is only an affordance hint on a button that is
 *   already visible, named and full-width, so it keeps the hover-reveal and rests
 *   at `opacity-40` behind `pointer-fine:opacity-0`.
 *
 * The prompt rows also had a WCAG 2.5.3 failure: the visible text of a row is the
 * prompt, but the accessible name was the bare string "Copy prompt", so a voice
 * user reading the prompt aloud could not hit the button.
 *
 * happy-dom loads no stylesheet, so a media-query-conditioned opacity cannot be
 * read back here — the resting/reveal pair is asserted on class tokens, which is
 * the same contract `cards/chart-action-classes.test.ts` locks in. Everything the
 * DOM can prove is asserted as behaviour: a named, focusable, keyboard-operable
 * control whose accessible name contains its visible text, and a hit target wide
 * enough for a finger.
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

let clipboardCalls: string[] = []
mock.module('@/lib/utils/clipboard', () => ({
  copyToClipboard: async (text: string) => {
    clipboardCalls.push(text)
    return true
  },
}))
mock.module('sonner', () => ({
  toast: { success: mock(() => {}), error: mock(() => {}) },
}))

const { CodeBlock, CopyButton } = await import('./copy-button')
const { McpExamplePrompts } = await import('./mcp-example-prompts')

/**
 * Source with comments removed, so a comment that NAMES the old defect (these
 * fixes explain themselves in place) is not mistaken for the defect returning.
 */
function code(file: string): string {
  return SOURCE[file].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const SOURCE = Object.fromEntries(
  ['copy-button.tsx', 'mcp-example-prompts.tsx'].map((name) => [
    name,
    readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8'),
  ])
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
  clipboardCalls = []
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

/**
 * The resting/reveal contract: a visible resting opacity, hidden only where a
 * hover actually exists, and a reveal that beats the fine-pointer hold-down.
 * `pointer-fine:opacity-0` contains the letters opacity-0 but is not a bare token,
 * so the only `opacity-0` allowed is that one guarded variant.
 */
function expectTouchVisible(className: string) {
  const parts = tokens(className)
  expect(parts).not.toContain('opacity-0')
  expect(parts.filter((t) => t.endsWith('opacity-0'))).toEqual([
    'pointer-fine:opacity-0',
  ])
  expect(parts).toContain('opacity-40')
  expect(className).toContain('pointer-fine:group-hover')
  expect(className).toContain('pointer-fine:group-focus-within')
  // Without `!` the reveal ties with `pointer-fine:group-hover:opacity-40` on
  // specificity and loses on source order — the reveal would be dead code.
  expect(className).toMatch(/group-hover:!opacity-100/)
}

/** No gate of any kind: the control is there for every pointer type. */
function expectNeverGated(className: string) {
  const parts = tokens(className)
  expect(parts.filter((t) => /opacity-/.test(t))).toEqual([])
}

/**
 * The reveal only works if some ancestor actually carries `group`. Assert it in
 * the DOM rather than trusting the source layout — the clusters/ sibling shipped
 * a `group-hover:opacity-100` whose button was a sibling of the `group`.
 */
function expectGroupAncestor(el: HTMLElement) {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    if (tokens(node.className ?? '').includes('group')) return
    node = node.parentElement
  }
  throw new Error(
    `no ancestor carries "group", so group-hover:opacity-100 can never fire for ${el.tagName}.${el.className}`
  )
}

async function click(el: Element | null | undefined) {
  const { act } = await import('react')
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('mcp code block copy button', () => {
  test('is permanently visible — no opacity gate anywhere', async () => {
    const root = await renderInto(
      <CodeBlock copyText="SELECT 1">{'SELECT 1'}</CodeBlock>
    )
    // The pre's parent is the positioned wrapper that used to carry the gate.
    const wrapper = root.querySelector('pre')?.parentElement as HTMLElement
    expectNeverGated(wrapper.className)

    // The gate is also gone from the source, so it cannot come back in a branch
    // this test does not render.
    expect(code('copy-button.tsx')).not.toMatch(/opacity-0/)
    expect(code('copy-button.tsx')).not.toMatch(
      /(hover|focus-within|focus-visible):opacity/
    )
  })

  test('is a named, keyboard-operable button that copies', async () => {
    const root = await renderInto(
      <CodeBlock copyText="SELECT 42">{'SELECT 42'}</CodeBlock>
    )
    const button = root.querySelector('button') as HTMLButtonElement

    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('tabindex')).toBe('0')
    expect(button.getAttribute('aria-label')).toBe('Copy')

    const { act } = await import('react')
    await act(async () => {
      button.focus()
    })
    expect(document.activeElement).toBe(button)

    await click(button)
    expect(clipboardCalls).toEqual(['SELECT 42'])
  })

  // The button is `absolute right-1 top-1` and the code block has no padding
  // reserved for it, so a coarse-pointer size can only grow inward — nothing else
  // in the block moves. Icon-only, so both axes.
  test('grows to a 36px square for a finger', async () => {
    const root = await renderInto(<CodeBlock>SELECT 1</CodeBlock>)
    const button = root.querySelector('button') as HTMLButtonElement
    const parts = tokens(button.className)

    expect(parts).toContain('pointer-coarse:size-9')
    expect(parts.filter((t) => /^pointer-coarse:(w|min-w)-/.test(t))).toEqual(
      []
    )
  })

  // The labelled variant is a different shape: `pointer-coarse:size-9` would pin
  // the pill narrower than its own content and push the icon and text outside the
  // rounded background, leaving a SMALLER tappable area than the mouse one. So it
  // grows height only and lets the width follow the label.
  test('the labelled variant grows height only, never a pinned width', async () => {
    const root = await renderInto(<CopyButton text="x" label="Copy endpoint" />)
    const button = root.querySelector('button') as HTMLButtonElement
    const parts = tokens(button.className)

    expect(parts).toContain('pointer-coarse:h-9')
    expect(
      parts.filter((t) => /^pointer-coarse:(size|w|min-w)-/.test(t))
    ).toEqual([])
    expect(button.textContent).toContain('Copy endpoint')
  })
})

describe('mcp example prompts', () => {
  test('the copy icon rests visible on touch with a guarded reveal', async () => {
    const root = await renderInto(<McpExamplePrompts />)
    const rows = root.querySelectorAll('button[aria-label*="prompt:"]')
    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      const icon = row.querySelector('span[aria-hidden]') as HTMLElement
      expect(icon).not.toBeNull()
      expectTouchVisible(icon.className)
      // `group` has to be on the row itself for the reveal to be reachable.
      expect(tokens((row as HTMLElement).className)).toContain('group')
      expectGroupAncestor(icon)
    }
  })

  // WCAG 2.5.3 Label in Name: the visible text of a row is the prompt, so the
  // accessible name must contain it — in both states, because only the icon swaps
  // when copied. `aria-label="Copy prompt"` did not.
  test('accessible name contains the visible prompt text (WCAG 2.5.3)', async () => {
    const root = await renderInto(<McpExamplePrompts />)
    const rows = [...root.querySelectorAll('button[aria-label*="prompt:"]')]

    for (const row of rows) {
      const visible = (row.textContent ?? '').replace(/\s+/g, ' ').trim()
      expect(visible.length).toBeGreaterThan(0)
      expect(row.getAttribute('aria-label')).toContain(visible)
      // The icon must not leak into the name.
      expect(row.getAttribute('aria-label')).toContain('Copy prompt:')
    }

    // Same promise after the copy flips the icon.
    const first = rows[0]
    await click(first)
    const after = [...root.querySelectorAll('button[aria-label*="prompt:"]')][0]
    const visible = (after.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(after.getAttribute('aria-label')).toContain(visible)
    expect(after.getAttribute('aria-label')).toContain('Copied prompt:')
    expect(clipboardCalls.length).toBe(1)
  })

  // Keyboard operability comes from the element being a real, type="button"
  // <button> — Enter and Space activation is browser behaviour, which a
  // synthetic KeyboardEvent in happy-dom does not perform, so the assertion is on
  // the element plus the click path it feeds.
  test('every prompt row is a focusable button that copies', async () => {
    const root = await renderInto(<McpExamplePrompts />)
    const row = root.querySelector('button[aria-label]') as HTMLButtonElement

    expect(row.tagName).toBe('BUTTON')
    expect(row.getAttribute('type')).toBe('button')
    expect(row.getAttribute('aria-label')).toBeTruthy()

    const { act } = await import('react')
    await act(async () => {
      row.focus()
    })
    expect(document.activeElement).toBe(row)

    await click(row)
    expect(clipboardCalls.length).toBe(1)
  })

  test('the icon is aria-hidden so it stays out of the name', () => {
    expect(code('mcp-example-prompts.tsx')).toContain('aria-hidden')
  })
})

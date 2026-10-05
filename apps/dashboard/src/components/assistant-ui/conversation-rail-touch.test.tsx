/**
 * Conversation archive/delete must be reachable without a hover (#3668).
 *
 * Both buttons rested at `opacity-0` behind `group-hover:opacity-100`, and
 * Tailwind v4 wraps a bare `hover:` in `@media (hover: hover)`. On a coarse
 * pointer neither was ever raised: archiving or deleting a saved conversation was
 * impossible, because there is no other path to those actions — no context menu,
 * no long-press, no "manage conversations" screen — and `ConversationRailBody`
 * also renders inside a mobile Drawer, where no hover ever happens.
 *
 * So this is a gate with no purpose behind it. The fix removes it rather than
 * re-arming it under `pointer-fine:`: a control that exists only to perform a
 * destructive action should not be a hover secret.
 *
 * happy-dom loads no stylesheet, so the opacity itself is not asserted here; the
 * absence of any opacity class is, and the reachability that made the gate
 * defensible (focusable, named, operable) is asserted as behaviour.
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

const calls: string[] = []

mock.module('@assistant-ui/react', () => ({
  useAui: () => ({
    threads: {
      switchToThread: async (id: string) => {
        calls.push(`switch:${id}`)
      },
      switchToNewThread: async () => {
        calls.push('new')
      },
      item: (args: { id: string }) => ({
        archive: async () => {
          calls.push(`archive:${args.id}`)
        },
        delete: async () => {
          calls.push(`delete:${args.id}`)
        },
      }),
    },
  }),
  useAuiState: () => [],
}))

const { ThreadRow } = await import('./conversation-rail')

/**
 * `ThreadRow` with comments stripped, so a comment naming the old defect is not
 * mistaken for the defect returning. Scoped to ThreadRow: `ConversationRail`'s
 * `opacity-0` is the rail's open/closed state (paired with `w-0` and
 * `pointer-events-none`), not a hover reveal, and out of scope here.
 */
const CODE = (() => {
  const source = readFileSync(
    fileURLToPath(new URL('./conversation-rail.tsx', import.meta.url)),
    'utf8'
  )
  const start = source.indexOf('export function ThreadRow')
  const end = source.indexOf('interface ConversationRailBodyProps')
  return source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
})()

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
  calls.length = 0
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

const ITEM = { id: 't1', title: 'Slow merges', createdAt: 0, isActive: false }

function actionButtons(root: HTMLElement): HTMLButtonElement[] {
  const buttons = [
    ...root.querySelectorAll('button[aria-label]'),
  ] as HTMLButtonElement[]
  const byLabel = new Map(buttons.map((b) => [b.getAttribute('aria-label'), b]))
  expect(byLabel.has('Archive')).toBe(true)
  expect(byLabel.has('Delete')).toBe(true)
  return [byLabel.get('Archive'), byLabel.get('Delete')] as HTMLButtonElement[]
}

describe('conversation row actions', () => {
  test('carry no opacity gate at all', async () => {
    const root = await renderInto(<ThreadRow item={ITEM} />)

    // Both the wrapper and the buttons themselves. `disabled:opacity-50` from the
    // Button base is a legitimate disabled state, not a reveal gate.
    for (const el of root.querySelectorAll('*')) {
      expect(
        tokens(el.getAttribute('class') ?? '').filter(
          (t) => /(^|:)opacity-/.test(t) && !t.startsWith('disabled:')
        )
      ).toEqual([])
    }

    // And the gate is gone from the source, so it cannot return in a branch this
    // test does not render.
    expect(CODE).not.toMatch(/opacity-0/)
    expect(CODE).not.toMatch(/(hover|focus-within|focus-visible):opacity/)
  })

  // The `group` on the row existed only to carry the reveal; with the gate gone it
  // would be dead markup that implies a behaviour that no longer exists.
  test('the row no longer claims a group it never uses', async () => {
    const root = await renderInto(<ThreadRow item={ITEM} />)
    for (const el of root.querySelectorAll('*')) {
      expect(tokens(el.getAttribute('class') ?? '')).not.toContain('group')
    }
  })

  test('each is a focusable, named button that performs its action', async () => {
    const root = await renderInto(<ThreadRow item={ITEM} />)

    for (const button of actionButtons(root)) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.getAttribute('aria-label')).toBeTruthy()

      const { act } = await import('react')
      await act(async () => {
        button.focus()
      })
      expect(document.activeElement).toBe(button)
    }

    const { act } = await import('react')
    const click = async (el: HTMLElement) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    const [archive, remove] = actionButtons(root)
    await click(archive)
    await click(remove)
    expect(calls).toEqual(['archive:t1', 'delete:t1'])
  })

  // Icon-only, so both axes grow. Nothing needs to move with them: the row is a
  // flex row whose neighbour is `min-w-0 flex-1 truncate`, so it absorbs the
  // extra 16px instead of pushing the title out of the rail.
  test('each grows to a 36px square for a finger', async () => {
    const root = await renderInto(<ThreadRow item={ITEM} />)

    for (const button of actionButtons(root)) {
      const parts = tokens(button.getAttribute('class') ?? '')
      expect(parts).toContain('size-7')
      expect(parts).toContain('pointer-coarse:size-9')
      expect(parts.filter((t) => /^pointer-coarse:(w|min-w)-/.test(t))).toEqual(
        []
      )
    }
  })

  // Icon-only buttons carry no visible text, so WCAG 2.5.3 has nothing to match;
  // what matters is that the two are distinguishable from each other.
  test('Archive and Delete are not confused for one another', async () => {
    const root = await renderInto(<ThreadRow item={ITEM} />)
    const labels = actionButtons(root).map((b) => b.getAttribute('aria-label'))
    expect(new Set(labels).size).toBe(2)
    for (const label of labels) {
      expect(label?.trim().length).toBeGreaterThan(0)
      // No whitespace-splicing bug: a name must not run two words together.
      expect(label).not.toMatch(/[a-z][A-Z]/)
    }
  })
})

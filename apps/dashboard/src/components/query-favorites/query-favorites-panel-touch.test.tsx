/**
 * The saved-queries action row must be reachable without a hover (#3668).
 *
 * Copy deep-link, Run, Edit and Remove all rested at `opacity-0` behind
 * `group-hover:opacity-100`, and Tailwind v4 wraps a bare `hover:` in
 * `@media (hover: hover)`. On a coarse pointer all four were present, focusable
 * and invisible — and none of the four has another path: no context menu, no
 * keyboard shortcut, no separate "manage favorites" screen. Editing a saved query's
 * name and tags, or removing it, was impossible by touch. The panel is a Sheet on
 * the SQL console and EXPLAIN pages, which are read on phones.
 *
 * So this is a gate with no purpose behind it: the fix removes it rather than
 * re-arming it under `pointer-fine:`.
 *
 * happy-dom loads no stylesheet, so opacity itself is not asserted here; the
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

mock.module('sonner', () => ({
  toast: { success: mock(() => {}), error: mock(() => {}) },
}))
mock.module('@/lib/utils/clipboard', () => ({
  copyToClipboard: async () => true,
}))

const calls: { kind: string; value?: string }[] = []
mock.module('@/lib/stores/use-query-favorites', () => ({
  useQueryFavorites: () => ({
    favorites: [
      {
        id: 'f1',
        title: 'Top queries by duration',
        sql: 'SELECT query FROM system.query_log LIMIT 10',
        tags: ['perf'],
        hostId: 0,
        database: null,
        createdAt: Date.now() - 120_000,
        shareUrl: '/sql?q=top&host=0',
      },
    ],
    remove: (id: string) => calls.push({ kind: 'remove', value: id }),
    update: (id: string, patch: Record<string, unknown>) =>
      calls.push({ kind: 'update', value: `${id}:${JSON.stringify(patch)}` }),
    save: () => {},
    isFavorited: () => false,
    refresh: () => {},
  }),
}))

const { QueryFavoritesPanel } = await import('./query-favorites-panel')

/** Comments stripped, so a comment naming the old defect is not the defect. */
const CODE = readFileSync(
  fileURLToPath(new URL('./query-favorites-panel.tsx', import.meta.url)),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

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

const ACTION_LABELS = [
  'Copy deep-link',
  'Run',
  'Edit name / tags',
  'Remove',
] as const

async function renderPanel(
  onSelect: (sql: string, run?: boolean) => void = () => {}
) {
  const root = await renderInto(<QueryFavoritesPanel onSelect={onSelect} />)
  const buttons = new Map(
    [...root.querySelectorAll('button[aria-label]')].map((b) => [
      b.getAttribute('aria-label'),
      b as HTMLButtonElement,
    ])
  )
  return { root, buttons }
}

describe('saved query action row', () => {
  test('carries no opacity gate at all', async () => {
    const { root } = await renderPanel()

    // `disabled:opacity-50` from the Button base is a legitimate disabled state,
    // not a reveal gate.
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

  // The `group` on the <li> existed only to carry the reveal; with the gate gone
  // it would be dead markup implying a behaviour that no longer exists.
  test('the row no longer claims a group it never uses', async () => {
    const { root } = await renderPanel()
    for (const el of root.querySelectorAll('*')) {
      expect(tokens(el.getAttribute('class') ?? '')).not.toContain('group')
    }
  })

  test('all four actions are present, focusable and named', async () => {
    const { buttons } = await renderPanel()

    for (const label of ACTION_LABELS) {
      const button = buttons.get(label) as HTMLButtonElement
      expect(button, `${label} must exist`).toBeDefined()
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.getAttribute('aria-label')).toBe(label)

      const { act } = await import('react')
      await act(async () => {
        button?.focus()
      })
      expect(document.activeElement).toBe(button)
    }
  })

  test('Run, Edit and Remove perform their action', async () => {
    const runs: string[] = []
    const { root, buttons } = await renderPanel((sql) => {
      runs.push(sql)
    })

    const { act } = await import('react')
    const click = async (el: HTMLElement | undefined) => {
      await act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    await click(buttons.get('Run'))
    expect(runs).toEqual(['SELECT query FROM system.query_log LIMIT 10'])

    await click(buttons.get('Remove'))
    expect(calls.map((c) => c.kind)).toContain('remove')
    expect(calls.some((c) => c.value === 'f1')).toBe(true)

    // Edit swaps the row for the name / tags form, so it goes last: after it the
    // action buttons are gone and two inputs take their place.
    await click(buttons.get('Edit name / tags'))
    expect(root.querySelectorAll('input').length).toBeGreaterThanOrEqual(2)
    expect(
      [...root.querySelectorAll('button[aria-label]')].map((b) =>
        b.getAttribute('aria-label')
      )
    ).not.toContain('Remove')
  })

  // Icon-only, so both axes grow. Nothing needs to move with them: the row is a
  // flex row whose neighbour is the "2m ago" timestamp, and four 36px buttons plus
  // their gaps still fit inside the 380px sheet.
  test('each grows to a 36px square for a finger', async () => {
    const { buttons } = await renderPanel()

    for (const label of ACTION_LABELS) {
      const parts = tokens(buttons.get(label)?.getAttribute('class') ?? '')
      expect(parts, label).toContain('size-6')
      expect(parts, label).toContain('pointer-coarse:size-9')
      expect(
        parts.filter((t) => /^pointer-coarse:(w|min-w)-/.test(t)),
        label
      ).toEqual([])
    }
  })

  // Icon-only buttons carry no visible text, so WCAG 2.5.3 has nothing to match.
  // What matters is that the four are distinguishable and none lost its name.
  test('the four names stay distinct and un-spliced', async () => {
    const { buttons } = await renderPanel()
    const names = ACTION_LABELS.map((l) => {
      const name = buttons.get(l)?.getAttribute('aria-label')
      expect(name, `${l} must have an accessible name`).toBeTruthy()
      return name as string
    })
    expect(new Set(names).size).toBe(4)
    for (const name of names) {
      expect(name.trim()).toBe(name)
      // A name must not run two words together ("Edit name/tags").
      expect(name).not.toMatch(/[a-z][A-Z]/)
    }
  })
})

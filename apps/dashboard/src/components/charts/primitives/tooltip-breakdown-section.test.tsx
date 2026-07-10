/**
 * Tests for the tooltip breakdown section (plan 81, issue #2498).
 *
 * The legend dots previously used `var(--chart-${10 - index})` — descending,
 * never matching the ascending series colors, and undefined past index 9
 * (`--chart-0`, `--chart--1` → invisible dots). Dots must follow the exact
 * series color arithmetic from `primitives/area.tsx` (`--chart-${index + 1}`,
 * ascending, no modulo). The value cell previously called
 * `value.toLocaleString()` unguarded, throwing on null/undefined.
 *
 * Rendering uses the repo's one-off happy-dom harness (same as
 * `recent-query-expanded-details.test.tsx`), since components are otherwise
 * covered by Cypress.
 */

import {
  BreakdownSection,
  type BreakdownValue,
  breakdownColorVar,
  formatBreakdownValue,
} from './tooltip-breakdown-section'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

describe('breakdownColorVar', () => {
  test('matches the series color arithmetic in area.tsx for every index', () => {
    // area.tsx assigns series colors as `var(--chart-${index + 1})` (ascending,
    // no modulo). The dot for breakdown row N must resolve the same token.
    for (let index = 0; index < 20; index++) {
      expect(breakdownColorVar(index)).toBe(`var(--chart-${index + 1})`)
    }
  })

  test('index 12 still resolves a defined theme token (--chart-1..13)', () => {
    // The theme defines --chart-1 through --chart-13; the old descending
    // arithmetic went undefined from index 10 (`--chart-0`).
    expect(breakdownColorVar(12)).toBe('var(--chart-13)')
  })
})

describe('formatBreakdownValue', () => {
  test('localizes numbers like the original rendering', () => {
    expect(formatBreakdownValue(1234567)).toBe((1234567).toLocaleString())
    expect(formatBreakdownValue(0)).toBe('0')
  })

  test('does not throw on non-numeric values', () => {
    expect(formatBreakdownValue(undefined)).toBe('')
    expect(formatBreakdownValue(null)).toBe('')
    expect(formatBreakdownValue('n/a')).toBe('n/a')
  })
})

describe('BreakdownSection', () => {
  async function renderSection(
    breakdownData: Array<[string, BreakdownValue]>,
    item: unknown = {},
    breakdownLabel?: string
  ): Promise<{ text: string; html: string; cleanup: () => void }> {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <BreakdownSection
          breakdownData={breakdownData}
          heading="Breakdown"
          item={item}
          breakdownLabel={breakdownLabel}
        />
      )
    })

    return {
      text: container.textContent ?? '',
      html: container.innerHTML,
      cleanup: () => {
        act(() => {
          root.unmount()
        })
        container.remove()
      },
    }
  }

  test('renders non-numeric values without throwing and colors dots ascending', async () => {
    const { text, html, cleanup } = await renderSection([
      ['Select', 1234],
      ['Insert', undefined],
      ['Alter', 'n/a'],
    ])

    try {
      expect(text).toContain('Select')
      expect(text).toContain((1234).toLocaleString())
      expect(text).toContain('n/a')
      // Dots follow the series convention: row 0 → --chart-1, row 2 → --chart-3.
      expect(html).toContain('var(--chart-1)')
      expect(html).toContain('var(--chart-3)')
      // The old descending arithmetic (--chart-10 for row 0) must be gone.
      expect(html).not.toContain('var(--chart-10)')
    } finally {
      cleanup()
    }
  })

  test('row index 10 gets a defined token instead of --chart-0', async () => {
    const rows: Array<[string, BreakdownValue]> = Array.from(
      { length: 11 },
      (_, i) => [`kind-${i}`, i]
    )
    const { html, cleanup } = await renderSection(rows)

    try {
      expect(html).toContain('var(--chart-11)')
      expect(html).not.toContain('var(--chart-0)')
      expect(html).not.toContain('var(--chart--1)')
    } finally {
      cleanup()
    }
  })

  test('non-object item falls back to the row name safely', async () => {
    const { text, cleanup } = await renderSection(
      [['Select', 1]],
      undefined,
      'query_kind'
    )

    try {
      expect(text).toContain('Select')
    } finally {
      cleanup()
    }
  })
})

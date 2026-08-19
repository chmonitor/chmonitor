/**
 * WHY: card view used to disable row virtualization, so a 1000-row cards
 * table mounted every card. Virtualization is only incompatible with
 * expandable rows — MobileTableCards already renders virtual items.
 */

import { isRowVirtualizationDisabled } from './use-data-table-view'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('isRowVirtualizationDisabled', () => {
  test('only expandable rows disable virtualization', () => {
    expect(isRowVirtualizationDisabled(undefined)).toBe(false)
    expect(isRowVirtualizationDisabled(null)).toBe(false)
    expect(isRowVirtualizationDisabled(false)).toBe(false)
    expect(isRowVirtualizationDisabled(true)).toBe(true)
    expect(isRowVirtualizationDisabled({ render: () => null })).toBe(true)
  })

  test('the hook no longer disables virtualization because view is cards', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'use-data-table-view.ts'),
      'utf8'
    )
    expect(src).not.toContain("view === 'cards'")
    expect(src).toContain('isRowVirtualizationDisabled(expandable)')
  })
})

/**
 * WHY: card view used to disable row virtualization, so a 1000-row cards
 * table mounted every card. Virtualization is only incompatible with
 * expandable rows — MobileTableCards already renders virtual items.
 */

import { isRowVirtualizationDisabled } from './use-data-table-view'
import { describe, expect, test } from 'bun:test'

describe('isRowVirtualizationDisabled', () => {
  test('only expandable rows disable virtualization', () => {
    expect(isRowVirtualizationDisabled(undefined)).toBe(false)
    expect(isRowVirtualizationDisabled(null)).toBe(false)
    expect(isRowVirtualizationDisabled(false)).toBe(false)
    expect(isRowVirtualizationDisabled(true)).toBe(true)
    expect(isRowVirtualizationDisabled({ render: () => null })).toBe(true)
  })
})

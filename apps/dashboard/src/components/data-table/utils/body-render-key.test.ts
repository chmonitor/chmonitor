/**
 * Unit tests for the table-body memo-busting key.
 *
 * WHY this test exists:
 *  - `computeTableBodyRenderKey` replaced a `JSON.stringify` of the full
 *    table state (see data-table.tsx). The contract is that the key MUST
 *    change whenever any of its 9 inputs changes, or the memoized table body
 *    goes stale and silently stops reflecting state (row expansion, sort,
 *    selection, ...). This file is the machine-checkable gate for that
 *    contract — it exercises every input independently.
 *  - It also pins two easy-to-break edge cases: `expanded: true` (select-all
 *    expand) must differ from `{}`, and selecting a *different* row at the
 *    same selection count must still change the key (a naive "count of
 *    selected rows" key would miss this).
 */

import { computeTableBodyRenderKey } from './body-render-key'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// Base input covering all 9 dimensions with non-empty values
// ---------------------------------------------------------------------------
const base = {
  sorting: [{ id: 'name', desc: false }],
  pagination: { pageIndex: 0, pageSize: 25 },
  expanded: { row_1: true },
  columnSizing: { name: 120, status: 80 },
  columnOrder: ['name', 'status'],
  columnVisibility: { name: true, status: true },
  rowSelection: { row_1: true },
  globalSearch: 'foo',
  advancedFilters: [{ field: 'status', op: 'eq', value: 'ok' }],
} satisfies Parameters<typeof computeTableBodyRenderKey>[0]

describe('computeTableBodyRenderKey', () => {
  test('identical inputs (different object references) produce an identical key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey(structuredClone(base))
    expect(b).toBe(a)
  })

  test('changing sort direction changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      sorting: [{ id: 'name', desc: true }],
    })
    expect(b).not.toBe(a)
  })

  test('adding a sort column changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      sorting: [...base.sorting, { id: 'status', desc: false }],
    })
    expect(b).not.toBe(a)
  })

  test('changing pagination.pageIndex changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      pagination: { ...base.pagination, pageIndex: 1 },
    })
    expect(b).not.toBe(a)
  })

  test('changing pagination.pageSize changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      pagination: { ...base.pagination, pageSize: 50 },
    })
    expect(b).not.toBe(a)
  })

  test('expanding an additional row changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      expanded: { ...base.expanded, row_2: true },
    })
    expect(b).not.toBe(a)
  })

  test('expanded: true (expand-all) differs from an empty expanded map', () => {
    const a = computeTableBodyRenderKey({ ...base, expanded: {} })
    const b = computeTableBodyRenderKey({ ...base, expanded: true })
    expect(b).not.toBe(a)
  })

  test('resizing a column changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      columnSizing: { ...base.columnSizing, name: 200 },
    })
    expect(b).not.toBe(a)
  })

  test('reordering columns changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      columnOrder: ['status', 'name'],
    })
    expect(b).not.toBe(a)
  })

  test('toggling column visibility changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      columnVisibility: { ...base.columnVisibility, status: false },
    })
    expect(b).not.toBe(a)
  })

  test('selecting an additional row changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      rowSelection: { ...base.rowSelection, row_2: true },
    })
    expect(b).not.toBe(a)
  })

  test('selecting a different row at the same selection count changes the key', () => {
    const a = computeTableBodyRenderKey({
      ...base,
      rowSelection: { row_1: true },
    })
    const b = computeTableBodyRenderKey({
      ...base,
      rowSelection: { row_2: true },
    })
    expect(b).not.toBe(a)
  })

  test('changing globalSearch changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({ ...base, globalSearch: 'bar' })
    expect(b).not.toBe(a)
  })

  test('changing advancedFilters changes the key', () => {
    const a = computeTableBodyRenderKey(base)
    const b = computeTableBodyRenderKey({
      ...base,
      advancedFilters: [{ field: 'status', op: 'eq', value: 'other' }],
    })
    expect(b).not.toBe(a)
  })
})

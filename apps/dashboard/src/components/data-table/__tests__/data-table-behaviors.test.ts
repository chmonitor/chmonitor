/**
 * Unit tests for data-table system behaviors.
 *
 * WHY these tests exist:
 *  - Filtering, sorting, column ordering, and table-behavior resolution are
 *    pure functions / deterministic algorithms. Covering them here gives
 *    instant, zero-infrastructure feedback without needing a browser.
 *  - The synthetic utility columns (__expand, select) have hard contracts
 *    (non-hideable, non-sortable, always first). Tests here prevent future
 *    edits from silently breaking those contracts.
 *  - Sorting by "actual value" (not the readable display string) is a
 *    non-obvious invariant; this test file pins it against the real
 *    production sort function.
 *
 * All filter functions (applyColumnFilters, applyGlobalSearch,
 * applyAdvancedFilters) are imported directly from the production module —
 * no local reimplementation.
 */

import { EXPAND_COLUMN_ID } from '../column-defs'
import { isColumnFilterable, normalizeColumnName } from '../column-defs/utils'
import {
  applyAdvancedFilters,
  applyColumnFilters,
  applyGlobalSearch,
} from '../hooks/use-filtered-data'
import { getCustomSortingFns } from '../sorting-fns'
import { resolveTableBehavior } from '../utils/resolve-table-behavior'
import { describe, expect, test } from 'bun:test'

function config(
  tableBehavior?: Record<string, unknown>
): Parameters<typeof resolveTableBehavior>[0]['queryConfig'] {
  return {
    name: 'test',
    sql: 'SELECT 1',
    columns: [],
    tableBehavior,
  } as Parameters<typeof resolveTableBehavior>[0]['queryConfig']
}

const ROWS = [
  { query: 'SELECT * FROM orders', user: 'alice', duration: 500 },
  { query: 'INSERT INTO orders VALUES (?)', user: 'bob', duration: 50 },
  { query: 'SELECT count() FROM events', user: 'alice', duration: 3000 },
  { query: 'DROP TABLE temp', user: 'admin', duration: 10 },
] as const

// applyColumnFilters (real production function)
//
// WHY: column filters are the primary narrowing mechanism when a user types
// into a column header search box. The AND-combination and readable_-prefix
// fallback are non-obvious; regressions here would silently drop matching rows.

describe('applyColumnFilters (production function)', () => {
  test('narrows rows to those matching the filter string', () => {
    const result = applyColumnFilters([...ROWS], { user: 'alice' }, true)
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.user === 'alice')).toBe(true)
  })

  test('is case-insensitive', () => {
    const upper = applyColumnFilters([...ROWS], { user: 'ALICE' }, true)
    const lower = applyColumnFilters([...ROWS], { user: 'alice' }, true)
    expect(upper).toEqual(lower)
  })

  test('empty filter string is a no-op (returns all rows)', () => {
    const result = applyColumnFilters([...ROWS], { user: '' }, true)
    expect(result).toHaveLength(ROWS.length)
  })

  test('multi-column filter is AND — row must match all columns', () => {
    const result = applyColumnFilters(
      [...ROWS],
      { user: 'alice', query: 'SELECT' },
      true
    )
    expect(result).toHaveLength(2)
    result.forEach((r) => {
      expect(r.user).toBe('alice')
      expect(r.query).toContain('SELECT')
    })
  })

  test('returns empty array when no row matches', () => {
    const result = applyColumnFilters([...ROWS], { user: 'nobody' }, true)
    expect(result).toHaveLength(0)
  })

  test('disabled flag (enableColumnFilters=false) skips filtering entirely', () => {
    const result = applyColumnFilters([...ROWS], { user: 'alice' }, false)
    expect(result).toHaveLength(ROWS.length)
  })

  test('readable_ prefix maps to the underlying column (normaliseColumnName fallback)', () => {
    // A filter on 'readable_duration' falls back to the 'duration' key when
    // 'readable_duration' itself is absent from the row.
    const rows = [
      { duration: 50, user: 'bob' },
      { duration: 3000, user: 'alice' },
    ]
    const result = applyColumnFilters(rows, { readable_duration: '50' }, true)
    expect(result).toHaveLength(1)
    expect(result[0].duration).toBe(50)
  })
})

// applyGlobalSearch (real production function)
//
// WHY: global search scans ALL columns. The invariant that object/function
// values are skipped (avoiding [object Object] matches) and that null/undefined
// don't throw must be pinned — both have caused bugs in similar codebases.

describe('applyGlobalSearch (production function)', () => {
  test('matches any column value containing the search term', () => {
    const result = applyGlobalSearch([...ROWS], 'alice')
    expect(result).toHaveLength(2)
  })

  test('empty string is a no-op', () => {
    expect(applyGlobalSearch([...ROWS], '')).toHaveLength(ROWS.length)
    expect(applyGlobalSearch([...ROWS], '   ')).toHaveLength(ROWS.length)
  })

  test('is case-insensitive', () => {
    const lower = applyGlobalSearch([...ROWS], 'alice')
    const upper = applyGlobalSearch([...ROWS], 'ALICE')
    expect(lower).toEqual(upper)
  })

  test('null and undefined cell values are skipped without throwing', () => {
    const sparse = [{ a: null, b: undefined, c: 'match' }] as unknown as Array<
      Record<string, unknown>
    >
    expect(applyGlobalSearch(sparse, 'match')).toHaveLength(1)
    expect(applyGlobalSearch(sparse, 'null')).toHaveLength(0)
  })

  test('object values are skipped — prevents [object Object] false matches', () => {
    const rows = [
      { name: 'plain', meta: { nested: 'object' } },
    ] as unknown as Array<Record<string, unknown>>
    // 'object' appears in [object Object] stringification — must NOT match
    expect(applyGlobalSearch(rows, 'object')).toHaveLength(0)
    // 'plain' is a primitive — must match
    expect(applyGlobalSearch(rows, 'plain')).toHaveLength(1)
  })

  test('numeric values match when search term is a number string', () => {
    const result = applyGlobalSearch([...ROWS], '500')
    expect(result).toHaveLength(1)
    expect(result[0].duration).toBe(500)
  })
})

// applyAdvancedFilters (real production function)
//
// WHY: advanced filters are AND-combined typed conditions (contains, equals,
// startsWith, endsWith, notContains). Each operator must behave exactly as
// advertised because the UI shows the operator label to the user — a mismatch
// between label and behaviour would be a silent correctness bug.

describe('applyAdvancedFilters (production function)', () => {
  test('contains: row included when cell value contains the filter', () => {
    const result = applyAdvancedFilters(
      [...ROWS],
      [{ id: '1', columnId: 'query', operator: 'contains', value: 'SELECT' }]
    )
    expect(result).toHaveLength(2)
  })

  test('equals: exact match only (case-insensitive)', () => {
    const result = applyAdvancedFilters(
      [...ROWS],
      [{ id: '1', columnId: 'user', operator: 'equals', value: 'alice' }]
    )
    expect(result.every((r) => r.user === 'alice')).toBe(true)
    expect(result.some((r) => r.user === 'admin')).toBe(false)
  })

  test('startsWith: only rows where cell starts with the value', () => {
    const result = applyAdvancedFilters(
      [...ROWS],
      [{ id: '1', columnId: 'query', operator: 'startsWith', value: 'SELECT' }]
    )
    expect(result).toHaveLength(2)
    result.forEach((r) => expect(r.query).toMatch(/^SELECT/i))
  })

  test('endsWith: only rows where cell ends with the value', () => {
    const result = applyAdvancedFilters(
      [...ROWS],
      [{ id: '1', columnId: 'query', operator: 'endsWith', value: 'temp' }]
    )
    expect(result).toHaveLength(1)
    expect(result[0].query).toMatch(/temp$/i)
  })

  test('notContains: excludes rows containing the value', () => {
    const result = applyAdvancedFilters(
      [...ROWS],
      [{ id: '1', columnId: 'query', operator: 'notContains', value: 'SELECT' }]
    )
    expect(result).toHaveLength(2)
    result.forEach((r) => expect(r.query).not.toMatch(/SELECT/i))
  })

  test('multiple conditions are AND-combined', () => {
    const result = applyAdvancedFilters(
      [...ROWS],
      [
        { id: '1', columnId: 'user', operator: 'equals', value: 'alice' },
        { id: '2', columnId: 'query', operator: 'contains', value: 'count' },
      ]
    )
    expect(result).toHaveLength(1)
    expect(result[0].user).toBe('alice')
    expect(result[0].query).toContain('count')
  })

  test('empty filter list is a no-op', () => {
    expect(applyAdvancedFilters([...ROWS], [])).toHaveLength(ROWS.length)
  })
})

// Custom sorting function tests
//
// WHY: sort_column_using_actual_value must sort by the raw numeric column, NOT
// by the human-readable string (e.g. "10 MiB" would sort differently from 10).
// This behaviour matters for BackgroundBar columns where readable_* columns are
// display-only and the numeric base column drives ordering.

describe('getCustomSortingFns → sort_column_using_actual_value', () => {
  const sortFns = getCustomSortingFns()
  const sort = sortFns.sort_column_using_actual_value

  function makeRow(data: Record<string, unknown>) {
    return { original: data } as { original: typeof data }
  }

  test('sorts numerically ascending by stripping readable_ prefix', () => {
    const a = makeRow({ bytes: 100, readable_bytes: '100 B' })
    const b = makeRow({ bytes: 50, readable_bytes: '50 B' })
    expect(sort(a as never, b as never, 'readable_bytes')).toBeGreaterThan(0)
    expect(sort(b as never, a as never, 'readable_bytes')).toBeLessThan(0)
  })

  test('sorts by pct_ column actual value (strips pct_ prefix)', () => {
    const a = makeRow({ rows: 80, pct_rows: 80 })
    const b = makeRow({ rows: 20, pct_rows: 20 })
    expect(sort(a as never, b as never, 'pct_rows')).toBeGreaterThan(0)
  })

  test('returns 0 when values are equal', () => {
    const a = makeRow({ bytes: 100, readable_bytes: '100 B' })
    const b = makeRow({ bytes: 100, readable_bytes: '100 B' })
    expect(sort(a as never, b as never, 'readable_bytes')).toBe(0)
  })

  test('returns 0 for non-numeric values (graceful fallthrough)', () => {
    const a = makeRow({ query: 'SELECT 1', readable_query: 'SELECT 1' })
    const b = makeRow({ query: 'SELECT 2', readable_query: 'SELECT 2' })
    expect(sort(a as never, b as never, 'readable_query')).toBe(0)
  })
})

// resolveTableBehavior — config/prop precedence
//
// WHY: the precedence stack (props > queryConfig.tableBehavior > defaults) must
// be stable so individual QueryConfigs can opt out of resizing/sorting without
// a global setting change, and a prop passed at the call site always wins.

describe('resolveTableBehavior', () => {
  test('returns sane defaults when nothing is configured', () => {
    const result = resolveTableBehavior({ queryConfig: config() })
    expect(result.enableColumnResizing).toBe(true)
    expect(result.columnResizeMode).toBe('onChange')
    expect(result.enableSorting).toBe(true)
    expect(result.enableColumnReordering).toBe(true)
  })

  test('queryConfig.tableBehavior overrides defaults', () => {
    const result = resolveTableBehavior({
      queryConfig: config({
        enableSorting: false,
        enableColumnResizing: false,
      }),
    })
    expect(result.enableSorting).toBe(false)
    expect(result.enableColumnResizing).toBe(false)
  })

  test('explicit prop overrides queryConfig setting (highest precedence)', () => {
    const result = resolveTableBehavior({
      queryConfig: config({ enableColumnReordering: false }),
      enableColumnReorderingProp: true,
    })
    expect(result.enableColumnReordering).toBe(true)
  })

  test('false prop overrides queryConfig enabled setting', () => {
    const result = resolveTableBehavior({
      queryConfig: config({ enableColumnReordering: true }),
      enableColumnReorderingProp: false,
    })
    expect(result.enableColumnReordering).toBe(false)
  })

  test('columnResizeMode can be set to onEnd via config', () => {
    const result = resolveTableBehavior({
      queryConfig: config({ columnResizeMode: 'onEnd' }),
    })
    expect(result.columnResizeMode).toBe('onEnd')
  })
})

// Synthetic utility column constants and ordering invariants
//
// WHY: __expand and select are non-data columns that must always be pinned
// first. If EXPAND_COLUMN_ID changes, every localStorage-persisted column order
// silently breaks. The pinning algorithm is a pure extraction of the logic
// from data-table.tsx — tested here without mounting the full component.

describe('synthetic utility column contracts', () => {
  test('EXPAND_COLUMN_ID is the literal string "__expand"', () => {
    expect(EXPAND_COLUMN_ID).toBe('__expand')
  })

  /** Pure extraction of the finalColumnOrder logic from data-table.tsx */
  function buildFinalColumnOrder(
    expandable: boolean,
    enableRowSelection: boolean,
    savedOrder: string[]
  ): string[] {
    const utilityIds: string[] = []
    if (expandable) utilityIds.push(EXPAND_COLUMN_ID)
    if (enableRowSelection) utilityIds.push('select')
    if (savedOrder.length === 0) return utilityIds.length ? utilityIds : []
    const dataOnly = savedOrder.filter((id) => !utilityIds.includes(id))
    return [...utilityIds, ...dataOnly]
  }

  test('__expand is pinned at position 0 when expandable is on', () => {
    const order = buildFinalColumnOrder(true, false, ['name', 'status'])
    expect(order[0]).toBe(EXPAND_COLUMN_ID)
    expect(order).toContain('name')
    expect(order).toContain('status')
  })

  test('select is pinned at position 0 when row selection is on (no expand)', () => {
    const order = buildFinalColumnOrder(false, true, ['name', 'status'])
    expect(order[0]).toBe('select')
  })

  test('when both are on, __expand comes before select', () => {
    const order = buildFinalColumnOrder(true, true, ['name', 'status'])
    expect(order[0]).toBe(EXPAND_COLUMN_ID)
    expect(order[1]).toBe('select')
  })

  test('utility columns in saved order are deduplicated (no doubles after restore)', () => {
    const savedOrder = ['name', 'status', EXPAND_COLUMN_ID, 'select']
    const order = buildFinalColumnOrder(true, true, savedOrder)
    expect(order.filter((id) => id === EXPAND_COLUMN_ID)).toHaveLength(1)
    expect(order.filter((id) => id === 'select')).toHaveLength(1)
  })

  test('legacy saved orders (pre-utility-columns) get utility columns prepended', () => {
    const legacyOrder = ['name', 'status'] // no utility columns in this old saved state
    const order = buildFinalColumnOrder(true, true, legacyOrder)
    expect(order[0]).toBe(EXPAND_COLUMN_ID)
    expect(order[1]).toBe('select')
    expect(order).toContain('name')
  })
})

// normalizeColumnName
//
// WHY: the filter and sort fallback logic uses normalizeColumnName to map
// readable_* display names back to the underlying data field. Getting this
// wrong causes silent filter misses.

describe('normalizeColumnName', () => {
  test('strips readable_ prefix', () => {
    expect(normalizeColumnName('readable_bytes')).toBe('bytes')
    expect(normalizeColumnName('readable_query')).toBe('query')
  })

  test('lowercases the result', () => {
    expect(normalizeColumnName('QueryID')).toBe('queryid')
    expect(normalizeColumnName('Readable_Bytes')).toBe('bytes')
  })

  test('passes through columns without the prefix', () => {
    expect(normalizeColumnName('duration')).toBe('duration')
    expect(normalizeColumnName('user')).toBe('user')
  })

  test('trims surrounding whitespace', () => {
    expect(normalizeColumnName('  readable_bytes  ')).toBe('bytes')
  })
})

// isColumnFilterable
//
// WHY: must only return true when the global enableColumnFilters flag is set,
// preventing accidental filtering of columns that weren't opted in.

describe('isColumnFilterable', () => {
  test('returns false when column filters globally disabled', () => {
    expect(isColumnFilterable('query', false, [])).toBe(false)
    expect(isColumnFilterable('query', false, ['query'])).toBe(false)
  })

  test('returns true for any column when no explicit whitelist given', () => {
    expect(isColumnFilterable('anything', true, [])).toBe(true)
  })

  test('returns true only for whitelisted columns', () => {
    const allowed = ['query', 'user']
    expect(isColumnFilterable('query', true, allowed)).toBe(true)
    expect(isColumnFilterable('user', true, allowed)).toBe(true)
    expect(isColumnFilterable('duration', true, allowed)).toBe(false)
  })
})

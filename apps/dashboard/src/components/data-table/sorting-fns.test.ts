import { getCustomSortingFns } from './sorting-fns'
import { describe, expect, test } from 'bun:test'

/**
 * WHY these tests exist:
 *  - sort_column_using_actual_value used to return 0 for any pair it couldn't
 *    parse as `typeof === 'number'`, which made null/undefined/numeric-string
 *    values compare as equal to everything — nullable ClickHouse columns
 *    (common with optional metrics) would then sort unpredictably instead of
 *    deterministically. These tests pin the null-aware, coercing replacement.
 */

const sortFns = getCustomSortingFns()
const sort = sortFns.sort_column_using_actual_value

function makeRow(data: Record<string, unknown>) {
  return { original: data } as { original: typeof data }
}

describe('sort_column_using_actual_value — null-aware numeric sort', () => {
  test('sorts plain numbers ascending', () => {
    const a = makeRow({ bytes: 100 })
    const b = makeRow({ bytes: 50 })
    expect(sort(a as never, b as never, 'bytes')).toBeGreaterThan(0)
    expect(sort(b as never, a as never, 'bytes')).toBeLessThan(0)
  })

  test('null sorts after a valid number, regardless of argument order', () => {
    const withValue = makeRow({ bytes: 50 })
    const withNull = makeRow({ bytes: null })
    // null (A) vs number (B) → A sorts after B → positive
    expect(
      sort(withNull as never, withValue as never, 'bytes')
    ).toBeGreaterThan(0)
    // number (A) vs null (B) → A sorts before B → negative
    expect(sort(withValue as never, withNull as never, 'bytes')).toBeLessThan(0)
  })

  test('numeric strings are coerced for comparison', () => {
    const stringValue = makeRow({ bytes: '5' })
    const numberValue = makeRow({ bytes: 3 })
    expect(
      sort(stringValue as never, numberValue as never, 'bytes')
    ).toBeGreaterThan(0)
    expect(
      sort(numberValue as never, stringValue as never, 'bytes')
    ).toBeLessThan(0)
  })

  test('two nulls compare equal', () => {
    const a = makeRow({ bytes: null })
    const b = makeRow({ bytes: null })
    expect(sort(a as never, b as never, 'bytes')).toBe(0)
  })

  test('undefined behaves the same as null (also sorts last)', () => {
    const withValue = makeRow({ bytes: 10 })
    const withUndefined = makeRow({})
    expect(
      sort(withUndefined as never, withValue as never, 'bytes')
    ).toBeGreaterThan(0)
  })

  test('non-numeric strings on both sides compare equal (graceful fallthrough)', () => {
    const a = makeRow({ query: 'SELECT 1' })
    const b = makeRow({ query: 'SELECT 2' })
    expect(sort(a as never, b as never, 'query')).toBe(0)
  })
})

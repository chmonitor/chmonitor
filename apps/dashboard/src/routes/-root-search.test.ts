/**
 * Tests for the root route's `?host=` search-param validator.
 *
 * `validateSearch` feeds `useHostId()` (via `useSearch({ strict: false })`),
 * which every query/chart hook trusts to be a plain number. Junk input must
 * resolve to host 0 instead of flowing downstream as NaN/Infinity/a float,
 * which previously produced error states instead of a graceful default.
 */

import { validateSearch } from './-root-search'
import { describe, expect, test } from 'bun:test'

describe('validateSearch', () => {
  test('valid integer strings parse to the matching number', () => {
    expect(validateSearch({ host: '0' })).toEqual({ host: 0 })
    expect(validateSearch({ host: '3' })).toEqual({ host: 3 })
    expect(validateSearch({ host: '42' })).toEqual({ host: 42 })
  })

  test('negative integers are kept (client-side connection ids)', () => {
    expect(validateSearch({ host: '-5' })).toEqual({ host: -5 })
    expect(validateSearch({ host: -1 })).toEqual({ host: -1 })
  })

  test('fractional values default to 0', () => {
    expect(validateSearch({ host: '1.5' })).toEqual({ host: 0 })
    expect(validateSearch({ host: 0.1 })).toEqual({ host: 0 })
  })

  test('non-numeric junk defaults to 0', () => {
    expect(validateSearch({ host: 'abc' })).toEqual({ host: 0 })
    expect(validateSearch({ host: '2abc' })).toEqual({ host: 0 })
  })

  test('missing host param defaults to 0', () => {
    expect(validateSearch({})).toEqual({ host: 0 })
  })

  test('null and undefined host default to 0', () => {
    expect(validateSearch({ host: null })).toEqual({ host: 0 })
    expect(validateSearch({ host: undefined })).toEqual({ host: 0 })
  })

  test('non-finite values default to 0', () => {
    expect(validateSearch({ host: 'Infinity' })).toEqual({ host: 0 })
    expect(validateSearch({ host: 'NaN' })).toEqual({ host: 0 })
  })

  test('host 0 is preserved, not treated as falsy/missing', () => {
    expect(validateSearch({ host: 0 })).toEqual({ host: 0 })
    expect(validateSearch({ host: '0' })).toEqual({ host: 0 })
  })
})

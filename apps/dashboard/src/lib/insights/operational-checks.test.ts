/**
 * Tests for the operational insight classifiers.
 *
 * These are pure functions (no ClickHouse / store I/O), so they are exercised
 * directly against boundary values — the same approach as `decideSeverity` in
 * `collectors.test.ts`, but in a file that never mocks `./collectors`, so it is
 * immune to the process-global `mock.module('./collectors')` used by the
 * throttle test and stays green in the full `bun test src/lib/insights` run.
 *
 * Each `action.href` asserted here MUST match the corresponding `deriveAction`
 * case in `read-insights.ts`: the inline action only survives the immediate
 * generate() response, while a page reload re-derives it from the metric. If the
 * two drift, insights silently lose their link after a reload.
 */

import {
  checkDetachedParts,
  checkFailedDictionaries,
  checkLongRunningQuery,
  checkStuckMutations,
  DETACHED_PARTS_MIN,
  DETACHED_PARTS_WARN,
  LONG_QUERY_CRITICAL_SECONDS,
  LONG_QUERY_WARN_SECONDS,
  STUCK_MUTATIONS_CRITICAL,
} from './operational-checks'
import { describe, expect, test } from 'bun:test'

describe('checkDetachedParts', () => {
  test('below the minimum is suppressed', () => {
    expect(checkDetachedParts(DETACHED_PARTS_MIN - 1)).toBeNull()
    expect(checkDetachedParts(0)).toBeNull()
  })

  test('at the minimum surfaces as a notice (info)', () => {
    const c = checkDetachedParts(DETACHED_PARTS_MIN)
    expect(c?.severity).toBe('info')
    expect(c?.category).toBe('storage')
    expect(c?.metric).toBe('detached_parts')
    expect(c?.value).toBe(DETACHED_PARTS_MIN)
    expect(c?.action).toEqual({ label: 'View tables', href: '/tables' })
  })

  test('at/above the warn threshold escalates to warning', () => {
    expect(checkDetachedParts(DETACHED_PARTS_WARN)?.severity).toBe('warning')
    expect(checkDetachedParts(DETACHED_PARTS_WARN + 100)?.severity).toBe(
      'warning'
    )
  })

  test('non-finite input is ignored', () => {
    expect(checkDetachedParts(Number.NaN)).toBeNull()
  })
})

describe('checkStuckMutations', () => {
  test('zero is suppressed', () => {
    expect(checkStuckMutations(0)).toBeNull()
  })

  test('a single stuck mutation is a warning with singular copy', () => {
    const c = checkStuckMutations(1)
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('reliability')
    expect(c?.metric).toBe('stuck_mutations')
    expect(c?.title).toContain('1 mutation is')
    expect(c?.action).toEqual({ label: 'View mutations', href: '/mutations' })
  })

  test('many stuck mutations escalate to critical with plural copy', () => {
    const c = checkStuckMutations(STUCK_MUTATIONS_CRITICAL)
    expect(c?.severity).toBe('critical')
    expect(c?.title).toContain('mutations are')
  })
})

describe('checkLongRunningQuery', () => {
  test('below the warn runtime is suppressed even with many queries', () => {
    expect(checkLongRunningQuery(LONG_QUERY_WARN_SECONDS - 1, 50)).toBeNull()
  })

  test('at the warn runtime is a performance warning', () => {
    const c = checkLongRunningQuery(LONG_QUERY_WARN_SECONDS, 1)
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('performance')
    expect(c?.metric).toBe('longest_running_query')
    expect(c?.action).toEqual({
      label: 'Open running queries',
      href: '/running-queries',
    })
  })

  test('at/above the critical runtime is critical', () => {
    expect(
      checkLongRunningQuery(LONG_QUERY_CRITICAL_SECONDS, 1)?.severity
    ).toBe('critical')
  })

  test('a second concurrent long query is mentioned in the detail', () => {
    expect(checkLongRunningQuery(LONG_QUERY_WARN_SECONDS, 3)?.detail).toContain(
      '3 queries over a minute'
    )
    // A single long query does not tack on the "(N queries...)" clause.
    expect(
      checkLongRunningQuery(LONG_QUERY_WARN_SECONDS, 1)?.detail
    ).not.toContain('queries over a minute')
  })
})

describe('checkFailedDictionaries', () => {
  test('zero is suppressed', () => {
    expect(checkFailedDictionaries(0)).toBeNull()
  })

  test('one failed dictionary is a reliability warning with singular copy', () => {
    const c = checkFailedDictionaries(1)
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('reliability')
    expect(c?.metric).toBe('failed_dictionaries')
    expect(c?.title).toContain('1 dictionary failed')
    expect(c?.action).toEqual({
      label: 'View dictionaries',
      href: '/dictionaries',
    })
  })

  test('several failures use plural copy', () => {
    expect(checkFailedDictionaries(3)?.title).toContain('3 dictionaries failed')
  })
})

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

import type { PartsPressureRow } from '../health/parts-pressure'

import {
  checkBrokenDetachedParts,
  checkDetachedParts,
  checkFailedDictionaries,
  checkInsertBackpressure,
  checkLongRunningQuery,
  checkPartsPressure,
  checkStuckMutations,
  checkStuckReplicationQueue,
  DETACHED_PARTS_MIN,
  LONG_QUERY_CRITICAL_SECONDS,
  LONG_QUERY_WARN_SECONDS,
  REPLICATION_QUEUE_STUCK_CRITICAL,
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
    expect(c?.action).toEqual({
      label: 'View detached parts',
      href: '/detached-parts',
    })
  })

  test('non-broken detached parts stay informational however many there are', () => {
    // Housekeeping, not damage — broken parts have their own critical check.
    expect(checkDetachedParts(10_000)?.severity).toBe('info')
  })

  test('non-finite input is ignored', () => {
    expect(checkDetachedParts(Number.NaN)).toBeNull()
  })
})

describe('checkBrokenDetachedParts', () => {
  test('zero is suppressed', () => {
    expect(checkBrokenDetachedParts(0)).toBeNull()
  })

  test('a single broken part is critical with its own metric key', () => {
    const c = checkBrokenDetachedParts(1)
    expect(c?.severity).toBe('critical')
    expect(c?.metric).toBe('broken_detached_parts')
    expect(c?.action?.href).toBe('/detached-parts')
    expect(c?.detail).toContain('What to do')
  })
})

describe('checkStuckReplicationQueue', () => {
  test('zero is suppressed', () => {
    expect(checkStuckReplicationQueue(0, 0)).toBeNull()
  })

  test('stuck entries warn, and escalate to critical at the threshold', () => {
    const c = checkStuckReplicationQueue(1, 150)
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('stuck_replication_queue')
    expect(c?.action?.href).toBe('/replication-queue')
    expect(c?.detail).toContain('150')
    expect(
      checkStuckReplicationQueue(REPLICATION_QUEUE_STUCK_CRITICAL, 0)?.severity
    ).toBe('critical')
  })
})

describe('checkInsertBackpressure', () => {
  test('no delayed and no rejected inserts is suppressed', () => {
    expect(checkInsertBackpressure(0, 0)).toBeNull()
    expect(checkInsertBackpressure(Number.NaN, Number.NaN)).toBeNull()
  })

  test('delayed only is a warning', () => {
    const c = checkInsertBackpressure(3, 0)
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('insert_backpressure')
    expect(c?.action?.href).toBe('/merges')
  })

  test('any rejection is critical, since rejected inserts are lost writes', () => {
    expect(checkInsertBackpressure(0, 1)?.severity).toBe('critical')
  })

  test('title has no counts so a dismissal survives regeneration', () => {
    expect(checkInsertBackpressure(3, 0)?.title).toBe(
      checkInsertBackpressure(9, 0)?.title
    )
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

  test('other concurrent long queries are mentioned in the detail, excluding the headline query', () => {
    expect(checkLongRunningQuery(720, 3)?.detail).toContain(
      '2 other queries over 5m'
    )
  })

  test('a single other long query uses the singular noun', () => {
    expect(checkLongRunningQuery(720, 2)?.detail).toContain(
      '1 other query over 5m'
    )
  })

  test('a lone long query does not tack on the "(N other...)" clause', () => {
    expect(
      checkLongRunningQuery(LONG_QUERY_WARN_SECONDS, 1)?.detail
    ).not.toContain('other quer')
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

describe('checkPartsPressure', () => {
  const row = (over: Partial<PartsPressureRow> = {}): PartsPressureRow => ({
    database: 'app',
    table: 'events',
    partition: '202607',
    parts: 100,
    throwLimit: 3000,
    delayLimit: 1000,
    netPartsPerHour: null,
    hoursToThrow: null,
    isDelaying: false,
    ...over,
  })

  test('a calm partition is not surfaced', () => {
    expect(checkPartsPressure(row())).toBeNull()
  })

  test('an imminent projected breach surfaces as a storage finding', () => {
    const c = checkPartsPressure(
      row({ parts: 800, netPartsPerHour: 200, hoursToThrow: 5 })
    )
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('storage')
    expect(c?.metric).toBe('parts_pressure')
    expect(c?.title).toBe('app.events is approaching too many parts')
    // Must match the deriveAction('parts_pressure') case in read-insights.ts.
    expect(c?.action).toEqual({ label: 'View merges', href: '/merges' })
  })

  test('an already-delaying partition is critical', () => {
    const c = checkPartsPressure(row({ parts: 1200, isDelaying: true }))
    expect(c?.severity).toBe('critical')
    expect(c?.detail).toContain('throttled')
  })

  test('title is stable across runs (no projected hours in the key surface)', () => {
    const a = checkPartsPressure(
      row({ parts: 800, netPartsPerHour: 200, hoursToThrow: 5 })
    )
    const b = checkPartsPressure(
      row({ parts: 850, netPartsPerHour: 400, hoursToThrow: 2.25 })
    )
    expect(a?.title).toBe(b?.title ?? '')
  })

  test('degrades to a fill-percent finding when part_log is disabled', () => {
    // delayLimit raised so the fill-percent fallback (not the delay rule) fires.
    const c = checkPartsPressure(
      row({ parts: 2900, delayLimit: 3000, hoursToThrow: null })
    )
    expect(c?.severity).toBe('warning')
    expect(c?.detail).toContain('system.part_log')
  })
})

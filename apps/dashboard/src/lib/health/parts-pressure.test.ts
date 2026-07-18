/**
 * Tests for the parts-pressure projection math and SQL builders.
 *
 * The math functions are pure (no ClickHouse I/O), so they are exercised
 * directly against boundary values. The SQL builders are asserted on the shape
 * that matters — the tables they read, the optional part_log dependency, and the
 * override/threshold precedence — rather than exact whitespace.
 */

import {
  buildPartsPressureCurrentSql,
  buildPartsPressurePercentSql,
  buildPartsPressureProjectionSql,
  classifyPartsPressure,
  DEFAULT_PARTS_TO_DELAY_INSERT,
  DEFAULT_PARTS_TO_THROW_INSERT,
  PARTS_PRESSURE_CRITICAL_WINDOW_HOURS,
  PARTS_PRESSURE_MIN_PARTS,
  PARTS_PRESSURE_WARN_WINDOW_HOURS,
  projectHoursToThreshold,
} from './parts-pressure'
import { describe, expect, test } from 'bun:test'

describe('projectHoursToThreshold', () => {
  test('projects linearly from a positive net rate', () => {
    // 3000 - 1000 = 2000 remaining at 500/h -> 4h
    expect(projectHoursToThreshold(1000, 3000, 500)).toBe(4)
  })

  test('returns null when the net rate is non-positive (merges keeping up)', () => {
    expect(projectHoursToThreshold(1000, 3000, 0)).toBeNull()
    expect(projectHoursToThreshold(1000, 3000, -50)).toBeNull()
  })

  test('returns null when part_log rate is unavailable', () => {
    expect(projectHoursToThreshold(1000, 3000, null)).toBeNull()
  })

  test('returns 0 when already at or past the throw limit', () => {
    expect(projectHoursToThreshold(3000, 3000, 100)).toBe(0)
    expect(projectHoursToThreshold(3200, 3000, 100)).toBe(0)
  })

  test('guards invalid limits', () => {
    expect(projectHoursToThreshold(1000, 0, 100)).toBeNull()
    expect(projectHoursToThreshold(Number.NaN, 3000, 100)).toBeNull()
  })
})

describe('classifyPartsPressure', () => {
  const base = { parts: 100, throwLimit: 3000, delayLimit: 1000 }

  test('already delaying is always critical', () => {
    expect(
      classifyPartsPressure({
        ...base,
        parts: 1000,
        hoursToThrow: 999,
      })
    ).toBe('critical')
  })

  test('projected breach within the critical window is critical', () => {
    expect(
      classifyPartsPressure({
        ...base,
        hoursToThrow: PARTS_PRESSURE_CRITICAL_WINDOW_HOURS,
      })
    ).toBe('critical')
  })

  test('projected breach within the warn window is a warning', () => {
    expect(
      classifyPartsPressure({
        ...base,
        hoursToThrow: PARTS_PRESSURE_WARN_WINDOW_HOURS,
      })
    ).toBe('warning')
  })

  test('projected breach beyond the warn window is suppressed', () => {
    expect(
      classifyPartsPressure({
        ...base,
        hoursToThrow: PARTS_PRESSURE_WARN_WINDOW_HOURS + 1,
      })
    ).toBeNull()
  })

  test('falls back to fill percent when no projection (part_log off)', () => {
    // delayLimit raised above parts so the delay-limit rule does not pre-empt
    // the fill-percent fallback we are exercising here.
    const noDelay = { parts: 0, throwLimit: 3000, delayLimit: 3000 }
    // 95%+ of throw -> warning even without a rate
    expect(
      classifyPartsPressure({ ...noDelay, parts: 2850, hoursToThrow: null })
    ).toBe('warning')
    // 80%+ -> info
    expect(
      classifyPartsPressure({ ...noDelay, parts: 2400, hoursToThrow: null })
    ).toBe('info')
    // below the warn fill -> nothing
    expect(
      classifyPartsPressure({ ...noDelay, parts: 500, hoursToThrow: null })
    ).toBeNull()
  })

  test('delay limit takes precedence over a benign projection', () => {
    expect(
      classifyPartsPressure({
        ...base,
        parts: 1200,
        delayLimit: 1000,
        hoursToThrow: null,
      })
    ).toBe('critical')
  })
})

describe('buildPartsPressurePercentSql', () => {
  const sql = buildPartsPressurePercentSql()

  test('reads parts, tables, and merge_tree_settings; exposes pressure_percent', () => {
    expect(sql).toContain('system.parts')
    expect(sql).toContain('system.tables')
    expect(sql).toContain('system.merge_tree_settings')
    expect(sql).toContain('AS pressure_percent')
  })

  test('does not depend on part_log (always-available scalar)', () => {
    expect(sql).not.toContain('system.part_log')
  })

  test('prefers per-table overrides then server default then compiled fallback', () => {
    expect(sql).toContain('throw_override')
    expect(sql).toContain(String(DEFAULT_PARTS_TO_THROW_INSERT))
  })

  test('ignores tiny partitions below the min-parts floor', () => {
    expect(sql).toContain(`>= ${PARTS_PRESSURE_MIN_PARTS}`)
  })
})

describe('buildPartsPressureProjectionSql', () => {
  const sql = buildPartsPressureProjectionSql({ rateWindowHours: 6, limit: 10 })

  test('measures the net rate from part_log NewPart vs RemovePart', () => {
    expect(sql).toContain('system.part_log')
    expect(sql).toContain("event_type = 'NewPart'")
    expect(sql).toContain("event_type = 'RemovePart'")
  })

  test('exposes projection columns and orders worst-first', () => {
    expect(sql).toContain('AS hours_to_throw')
    expect(sql).toContain('AS is_delaying')
    expect(sql).toContain('AS net_parts_per_hour')
    expect(sql).toContain('ORDER BY is_delaying DESC')
  })

  test('interpolates a safe integer window and limit', () => {
    const injected = buildPartsPressureProjectionSql({
      rateWindowHours: Number.NaN,
      limit: -5,
    })
    expect(injected).toContain('INTERVAL 6 HOUR')
    expect(injected).toContain('LIMIT 20')
  })
})

describe('buildPartsPressureCurrentSql', () => {
  const sql = buildPartsPressureCurrentSql()

  test('is the part_log-free fallback (no rate/projection columns)', () => {
    expect(sql).not.toContain('system.part_log')
    expect(sql).not.toContain('hours_to_throw')
    expect(sql).toContain('system.parts')
    expect(sql).toContain('AS is_delaying')
  })

  test('still resolves delay/throw limits from settings', () => {
    expect(sql).toContain('system.merge_tree_settings')
    expect(sql).toContain(String(DEFAULT_PARTS_TO_DELAY_INSERT))
  })
})

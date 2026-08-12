/**
 * Tests for the shared `clampLimit` helper used by every insights backend
 * (ClickHouse, D1, Postgres, AgentState, memory) and the `/api/v1/findings`
 * route to bound a caller-supplied row limit into `[1, 1000]`.
 *
 * Regression coverage for #2952: a non-numeric `?limit=` (parsed to `NaN`
 * upstream) must fall back to the default page size, not silently collapse
 * to a single row.
 */

import { clampLimit } from './types'
import { describe, expect, test } from 'bun:test'

describe('clampLimit', () => {
  test('defaults to the fallback when limit is undefined', () => {
    expect(clampLimit(undefined)).toBe(100)
    expect(clampLimit(undefined, 50)).toBe(50)
  })

  test('NaN limit falls back to the default instead of clamping to 1', () => {
    expect(clampLimit(Number.NaN)).toBe(100)
    expect(clampLimit(Number.NaN, 25)).toBe(25)
  })

  test('NaN produced by parsing an invalid ?limit= string falls back cleanly', () => {
    const limit = Number.parseInt('abc', 10)
    expect(Number.isNaN(limit)).toBe(true)
    expect(clampLimit(limit)).toBe(100)
  })

  test('non-finite (Infinity) limit falls back to the default', () => {
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(100)
    expect(clampLimit(Number.NEGATIVE_INFINITY)).toBe(100)
  })

  test('clamps in-range limits to themselves', () => {
    expect(clampLimit(1)).toBe(1)
    expect(clampLimit(250)).toBe(250)
    expect(clampLimit(1000)).toBe(1000)
  })

  test('clamps below the floor up to 1', () => {
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
  })

  test('clamps above the ceiling down to 1000', () => {
    expect(clampLimit(5000)).toBe(1000)
  })

  test('truncates fractional limits', () => {
    expect(clampLimit(2.9)).toBe(2)
  })
})

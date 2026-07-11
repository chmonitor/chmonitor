import {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  type UserSettings,
} from './user-settings'
import { describe, expect, test } from 'bun:test'

describe('mergeUserSettings', () => {
  test('a legacy stored blob (only timezone + theme) fills new keys from defaults', () => {
    // Represents settings persisted before Units/Colors/Layout existed.
    const legacy = { timezone: 'America/New_York', theme: 'dark' }
    const merged = mergeUserSettings(legacy)

    expect(merged.timezone).toBe('America/New_York')
    expect(merged.theme).toBe('dark')
    // New keys must resolve to their defaults, not undefined.
    expect(merged.byteUnit).toBe('binary')
    expect(merged.numberFormat).toBe('abbreviated')
    expect(merged.chartPalette).toBe('default')
    expect(merged.tableDensity).toBe('comfortable')
    expect(merged.defaultTimeRange).toBe('24h')
  })

  test('stored values override the defaults', () => {
    const stored: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      byteUnit: 'decimal',
      numberFormat: 'full',
      chartPalette: 'colorblind-safe',
      tableDensity: 'compact',
      defaultTimeRange: '7d',
    }
    const merged = mergeUserSettings(stored)
    expect(merged).toEqual(stored)
  })

  test('null / non-object input returns a fresh copy of the defaults', () => {
    expect(mergeUserSettings(null)).toEqual(DEFAULT_USER_SETTINGS)
    expect(mergeUserSettings('junk')).toEqual(DEFAULT_USER_SETTINGS)
    // Must be a copy, not the shared reference.
    expect(mergeUserSettings(null)).not.toBe(DEFAULT_USER_SETTINGS)
  })

  test('default byteUnit/numberFormat reproduce historical behaviour', () => {
    // Guards the fail-closed invariant at the type level.
    expect(DEFAULT_USER_SETTINGS.byteUnit).toBe('binary')
    expect(DEFAULT_USER_SETTINGS.numberFormat).toBe('abbreviated')
  })
})

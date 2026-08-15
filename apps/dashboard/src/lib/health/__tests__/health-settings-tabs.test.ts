/**
 * Deep-link survival for the alert/health settings surface.
 *
 * The page collapsed ten tabs into four, so every retired `?tab=` id is a URL
 * already in the wild — in the menu, in the docs, in bookmarks. These tests
 * exist to fail the moment one of them stops resolving.
 */

import {
  HEALTH_SETTINGS_TABS,
  isHealthSettingsTab,
  LEGACY_TAB_MAP,
  resolveHealthSettingsTab,
} from '../health-settings-tabs'
import { describe, expect, test } from 'bun:test'

/**
 * The ten tab ids the page shipped with before the redesign. Hardcoded on
 * purpose — deriving this from `LEGACY_TAB_MAP` would make the test pass
 * trivially the moment someone deletes an entry, which is the exact regression
 * it is here to catch.
 */
const PRE_REDESIGN_TAB_IDS = [
  'thresholds',
  'alerts',
  'active',
  'history',
  'routing',
  'webhooks',
  'maintenance',
  'quiet-hours',
  'suggested',
  'custom-rules',
] as const

/**
 * The dialog sections `AdvancedSettingsPanel` renders. Kept as a literal rather
 * than imported: that module's `ADVANCED_SECTIONS` carries JSX `render()`
 * closures, so importing it would pull all seven advanced panels into a unit
 * test.
 */
const ADVANCED_SECTION_IDS = [
  'routing',
  'webhooks',
  'quiet-hours',
  'maintenance',
  'digest',
  'suggested',
  'custom-rules',
] as const

describe('resolveHealthSettingsTab', () => {
  test('every pre-redesign tab id still resolves to a real tab', () => {
    for (const id of PRE_REDESIGN_TAB_IDS) {
      const resolved = resolveHealthSettingsTab(id)
      expect(HEALTH_SETTINGS_TABS).toContain(resolved.tab)
    }
  })

  test('every advancedSection it returns is a section the panel can render', () => {
    // A typo here would land the user on Advanced with no dialog open — the
    // deep link would look like it worked and silently do nothing.
    for (const id of Object.keys(LEGACY_TAB_MAP)) {
      const { advancedSection } = resolveHealthSettingsTab(id)
      if (advancedSection) {
        expect(ADVANCED_SECTION_IDS).toContain(advancedSection)
      }
    }
  })

  test('the six retired panel tabs open their dialog on the Advanced tab', () => {
    const expected: Record<string, string> = {
      routing: 'routing',
      webhooks: 'webhooks',
      maintenance: 'maintenance',
      'quiet-hours': 'quiet-hours',
      suggested: 'suggested',
      'custom-rules': 'custom-rules',
    }
    for (const [tabId, section] of Object.entries(expected)) {
      expect(resolveHealthSettingsTab(tabId)).toEqual({
        tab: 'advanced',
        advancedSection: section,
      })
    }
  })

  test('the two merged history tabs both land on Activity, with no dialog', () => {
    expect(resolveHealthSettingsTab('active')).toEqual({ tab: 'activity' })
    expect(resolveHealthSettingsTab('history')).toEqual({ tab: 'activity' })
  })

  test('the surviving tab ids resolve to themselves', () => {
    for (const tab of HEALTH_SETTINGS_TABS) {
      expect(resolveHealthSettingsTab(tab).tab).toBe(tab)
    }
  })

  test('an absent or unknown tab falls back to Alerts', () => {
    expect(resolveHealthSettingsTab(undefined)).toEqual({ tab: 'alerts' })
    expect(resolveHealthSettingsTab('')).toEqual({ tab: 'alerts' })
    expect(resolveHealthSettingsTab('not-a-tab')).toEqual({ tab: 'alerts' })
  })

  test('a prototype key is not mistaken for a tab', () => {
    // `value in LEGACY_TAB_MAP` would otherwise be true for inherited keys.
    expect(resolveHealthSettingsTab('toString')).toEqual({ tab: 'alerts' })
    expect(resolveHealthSettingsTab('constructor')).toEqual({ tab: 'alerts' })
  })
})

describe('isHealthSettingsTab', () => {
  test('accepts every current and pre-redesign id', () => {
    for (const id of [...HEALTH_SETTINGS_TABS, ...PRE_REDESIGN_TAB_IDS]) {
      expect(isHealthSettingsTab(id)).toBe(true)
    }
  })

  test('rejects unknown and absent values', () => {
    expect(isHealthSettingsTab(undefined)).toBe(false)
    expect(isHealthSettingsTab('nope')).toBe(false)
  })
})

/**
 * Deep-link survival for the alert/health settings surface.
 *
 * The page collapsed ten tabs into four, so every retired `?tab=` id is a URL
 * already in the wild — in the menu, in the docs, in bookmarks. These tests
 * exist to fail the moment one of them stops resolving.
 */

import type { AdvancedSectionId } from '../health-settings-tabs'

import {
  ADVANCED_SECTION_PLACEMENT,
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
  'peerdb-rules',
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

  test('#3438: each retired panel tab opens its dialog on the tab that now hosts its group', () => {
    // Hardcoded, not derived from ADVANCED_SECTION_PLACEMENT, so moving a
    // section silently cannot keep this green.
    const expected: Record<
      string,
      { tab: string; section: AdvancedSectionId }
    > = {
      suggested: { tab: 'alerts', section: 'suggested' },
      'custom-rules': { tab: 'alerts', section: 'custom-rules' },
      'peerdb-rules': { tab: 'alerts', section: 'peerdb-rules' },
      routing: { tab: 'alerts', section: 'routing' },
      webhooks: { tab: 'alerts', section: 'webhooks' },
      digest: { tab: 'alerts', section: 'digest' },
      maintenance: { tab: 'advanced', section: 'maintenance' },
      'quiet-hours': { tab: 'advanced', section: 'quiet-hours' },
    }
    for (const [tabId, { tab, section }] of Object.entries(expected)) {
      expect(resolveHealthSettingsTab(tabId)).toEqual({
        tab: tab as never,
        advancedSection: section,
      })
    }
  })

  test('#3438: every section is placed in exactly one group, on a real tab', () => {
    expect(Object.keys(ADVANCED_SECTION_PLACEMENT).sort()).toEqual(
      [...ADVANCED_SECTION_IDS].sort()
    )
    for (const { tab } of Object.values(ADVANCED_SECTION_PLACEMENT)) {
      expect(HEALTH_SETTINGS_TABS).toContain(tab)
    }
  })

  test('#3438: group ids resolve to the tab that renders the group', () => {
    expect(resolveHealthSettingsTab('define')).toEqual({ tab: 'alerts' })
    expect(resolveHealthSettingsTab('delivery')).toEqual({ tab: 'alerts' })
    expect(resolveHealthSettingsTab('silencing')).toEqual({ tab: 'advanced' })
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

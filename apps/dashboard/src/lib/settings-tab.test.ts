import { isSettingsTab, SETTINGS_TABS } from './settings-tab'
import { describe, expect, test } from 'bun:test'

describe('isSettingsTab', () => {
  test('accepts the Navigation pane id', () => {
    expect(isSettingsTab('navigation')).toBe(true)
    expect(SETTINGS_TABS).toContain('navigation')
  })

  test('rejects unknown ids', () => {
    expect(isSettingsTab('general')).toBe(true)
    expect(isSettingsTab('not-a-tab')).toBe(false)
  })
})

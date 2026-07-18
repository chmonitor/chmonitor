// @ts-nocheck — test file, only runs under bun:test

import type { SettingRow } from '../types'

import { runSettingsRules } from '../settings-rules'
import { describe, expect, test } from 'bun:test'

function setting(overrides: Partial<SettingRow> = {}): SettingRow {
  return {
    name: 'x',
    value: '0',
    changed: true,
    default: '0',
    source: 'settings',
    ...overrides,
  }
}

describe('runSettingsRules', () => {
  test('flags unlimited max_memory_usage as high severity', () => {
    const findings = runSettingsRules([
      setting({ name: 'max_memory_usage', value: '0', source: 'settings' }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('setting_tuning')
    expect(findings[0].category).toBe('settings')
    expect(findings[0].target).toBe('max_memory_usage')
    expect(findings[0].severity).toBe('high')
    expect(findings[0].ddl).toContain('SET max_memory_usage')
    expect(findings[0].estimatedBytesSaved).toBe(0)
  })

  test('does not flag max_memory_usage when a limit is set', () => {
    expect(
      runSettingsRules([
        setting({ name: 'max_memory_usage', value: '10000000000' }),
      ])
    ).toEqual([])
  })

  test('flags index_granularity outliers but not the default or near-default', () => {
    expect(
      runSettingsRules([
        setting({
          name: 'index_granularity',
          value: '512',
          source: 'merge_tree_settings',
        }),
      ])
    ).toHaveLength(1)
    expect(
      runSettingsRules([
        setting({
          name: 'index_granularity',
          value: '8192',
          source: 'merge_tree_settings',
        }),
      ])
    ).toEqual([])
    expect(
      runSettingsRules([
        setting({
          name: 'index_granularity',
          value: '8192',
          source: 'settings',
        }),
      ])
    ).toEqual([])
  })

  test('flags a low parts_to_throw_insert', () => {
    const findings = runSettingsRules([
      setting({
        name: 'parts_to_throw_insert',
        value: '50',
        source: 'merge_tree_settings',
      }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].ddl).toContain('MODIFY SETTING parts_to_throw_insert')
  })

  test('matches on source so a same-named server setting is not confused with merge-tree', () => {
    // parts_to_throw_insert only exists in merge_tree_settings; a stray server
    // row of the same name must not fire the merge-tree rule.
    expect(
      runSettingsRules([
        setting({
          name: 'parts_to_throw_insert',
          value: '50',
          source: 'settings',
        }),
      ])
    ).toEqual([])
  })

  test('returns nothing for an empty settings list', () => {
    expect(runSettingsRules([])).toEqual([])
  })
})

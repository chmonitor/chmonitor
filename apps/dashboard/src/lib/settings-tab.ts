export const SETTINGS_TABS = [
  'general',
  'appearance',
  'units',
  'layout',
  'navigation',
  'integrations',
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export function isSettingsTab(value: string): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value)
}

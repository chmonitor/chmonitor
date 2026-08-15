/**
 * Tab identity for the alert/health settings surface.
 *
 * Lives here rather than in `health-settings-panel.tsx` so it stays pure —
 * importing the panel pulls in every advanced panel component transitively,
 * which a unit test has no business loading.
 */

/**
 * The four tabs the page renders. The surface used to have ten, six of which
 * were single panels an operator visits once a quarter — those now live behind
 * cards in `Advanced`.
 */
export const HEALTH_SETTINGS_TABS = [
  'alerts',
  'thresholds',
  'activity',
  'advanced',
] as const

export type HealthSettingsTab = (typeof HEALTH_SETTINGS_TABS)[number]

/** A section of the `Advanced` tab, each rendered inside its own dialog. */
export type AdvancedSectionId =
  | 'routing'
  | 'webhooks'
  | 'maintenance'
  | 'quiet-hours'
  | 'digest'
  | 'suggested'
  | 'custom-rules'

export interface ResolvedHealthSettingsTab {
  tab: HealthSettingsTab
  advancedSection?: AdvancedSectionId
}

/**
 * Every `?tab=` value the page understands — the four current ids plus the ten
 * pre-collapse ones — mapped to where that content lives now.
 *
 * Deep links from the menu, docs and older bookmarks must keep working, so a
 * retired id resolves to its new tab and (where the panel moved into a dialog)
 * the section to open. Removing an entry breaks a URL that is already in the
 * wild; add, don't replace.
 */
export const LEGACY_TAB_MAP: Readonly<
  Record<string, ResolvedHealthSettingsTab>
> = {
  thresholds: { tab: 'thresholds' },
  alerts: { tab: 'alerts' },
  active: { tab: 'activity' },
  history: { tab: 'activity' },
  activity: { tab: 'activity' },
  advanced: { tab: 'advanced' },
  routing: { tab: 'advanced', advancedSection: 'routing' },
  webhooks: { tab: 'advanced', advancedSection: 'webhooks' },
  maintenance: { tab: 'advanced', advancedSection: 'maintenance' },
  'quiet-hours': { tab: 'advanced', advancedSection: 'quiet-hours' },
  digest: { tab: 'advanced', advancedSection: 'digest' },
  suggested: { tab: 'advanced', advancedSection: 'suggested' },
  'custom-rules': { tab: 'advanced', advancedSection: 'custom-rules' },
}

/**
 * True for any tab id this page understands, including the legacy ones.
 *
 * `Object.hasOwn`, not `in` / a bare lookup: the value comes from `?tab=` in the
 * URL, so `?tab=toString` would otherwise match `Object.prototype.toString` and
 * hand a function to the caller as if it were a tab.
 */
export function isHealthSettingsTab(value: string | undefined): boolean {
  return value !== undefined && Object.hasOwn(LEGACY_TAB_MAP, value)
}

/** Resolve any (current or legacy) `?tab=` value to a tab + optional dialog. */
export function resolveHealthSettingsTab(
  value: string | undefined
): ResolvedHealthSettingsTab {
  return isHealthSettingsTab(value)
    ? LEGACY_TAB_MAP[value as string]
    : { tab: 'alerts' }
}

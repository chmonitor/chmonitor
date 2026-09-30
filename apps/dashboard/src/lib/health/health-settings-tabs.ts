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

/**
 * The three groups the seven former Advanced sections are sorted into (#3438).
 *
 * - `define`    — things that create alerts; sit under the built-in alert list.
 * - `delivery`  — things that decide where/how an alert is sent; sit with channels.
 * - `silencing` — things that hold alerts back; the only group left on Advanced.
 */
export type AdvancedGroupId = 'define' | 'delivery' | 'silencing'

/** Where each section lives now: the tab that renders its group. */
export const ADVANCED_SECTION_PLACEMENT: Readonly<
  Record<AdvancedSectionId, { tab: HealthSettingsTab; group: AdvancedGroupId }>
> = {
  suggested: { tab: 'alerts', group: 'define' },
  'custom-rules': { tab: 'alerts', group: 'define' },
  routing: { tab: 'alerts', group: 'delivery' },
  webhooks: { tab: 'alerts', group: 'delivery' },
  digest: { tab: 'alerts', group: 'delivery' },
  maintenance: { tab: 'advanced', group: 'silencing' },
  'quiet-hours': { tab: 'advanced', group: 'silencing' },
}

const section = (id: AdvancedSectionId): ResolvedHealthSettingsTab => ({
  tab: ADVANCED_SECTION_PLACEMENT[id].tab,
  advancedSection: id,
})

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
  routing: section('routing'),
  webhooks: section('webhooks'),
  maintenance: section('maintenance'),
  'quiet-hours': section('quiet-hours'),
  digest: section('digest'),
  suggested: section('suggested'),
  'custom-rules': section('custom-rules'),
  // Group ids (#3438) — link to a whole group without naming one section.
  define: { tab: 'alerts' },
  delivery: { tab: 'alerts' },
  silencing: { tab: 'advanced' },
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

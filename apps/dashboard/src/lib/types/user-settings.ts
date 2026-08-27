import { DEFAULT_HIDDEN_MENU_HREFS } from '@/lib/menu/slim-default'
import { parseLastSeenChangelogVersion } from '@/lib/whats-new/version'

export type ByteUnit = 'binary' | 'decimal'
export type NumberFormat = 'abbreviated' | 'full'
export type ChartPalette = 'default' | 'colorblind-safe' | 'monochrome'
export type TableDensity = 'comfortable' | 'compact'
export type DefaultTimeRange = '1h' | '6h' | '24h' | '7d' | '30d'
export type WorkspacePreset = 'full' | 'dba' | 'engineer' | 'sre' | 'custom'

export interface UserSettings {
  timezone: string // IANA timezone identifier (e.g., 'America/New_York')
  theme: 'light' | 'dark' | 'system'
  /** Byte size units: binary (1024, KiB) or decimal (1000, KB). */
  byteUnit: ByteUnit
  /** Large-number display: abbreviated (1.2M) or full (1,200,000). */
  numberFormat: NumberFormat
  /** Chart series color palette. */
  chartPalette: ChartPalette
  /** Data-table row density. */
  tableDensity: TableDensity
  /** Initial global time range for time-series pages. */
  defaultTimeRange: DefaultTimeRange
  /**
   * Dim (gray out) menu pages whose backing table is unavailable on the host.
   * When false, those pages are hidden from the menu entirely. Defaults to
   * true to preserve the long-standing "gray, don't hide" behaviour.
   */
  dimUnavailablePages: boolean
  /**
   * Role workspace preset. Full is the only auto-expand preset (new menu
   * pages stay visible). Named presets keep a stable group set. Custom uses
   * `hiddenMenuHrefs` as a hide list. First-run default is Custom + the
   * Essential keep list (`DEFAULT_HIDDEN_MENU_HREFS`); Full still restores
   * every page. DBA / Engineer / SRE stay group-title presets (not leaf
   * keep-lists).
   */
  workspacePreset: WorkspacePreset
  /**
   * Menu hrefs hidden from the sidebar and More. Hide is not unauthorized
   * and does not filter ⌘K — hidden pages stay indexed with a Hidden hint
   * and stay reachable by URL. Footer / Settings / host switcher are never
   * filtered here.
   */
  hiddenMenuHrefs: string[]
  /**
   * Last dashboard version whose What's new dialog the user dismissed.
   * Empty means never acknowledged. Compared against APP_VERSION from
   * `apps/dashboard/src/package.json`.
   */
  lastSeenChangelogVersion: string
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  timezone: Intl?.DateTimeFormat()?.resolvedOptions()?.timeZone || 'UTC',
  theme: 'system',
  byteUnit: 'binary',
  numberFormat: 'abbreviated',
  chartPalette: 'default',
  tableDensity: 'comfortable',
  defaultTimeRange: '24h',
  dimUnavailablePages: true,
  workspacePreset: 'custom',
  hiddenMenuHrefs: [...DEFAULT_HIDDEN_MENU_HREFS],
  lastSeenChangelogVersion: '',
}

export const USER_SETTINGS_STORAGE_KEY = 'clickhouse-monitor-user-settings'

/**
 * Merge a persisted settings object (which may predate newer keys) over the
 * defaults, so a stored blob missing `byteUnit` / `chartPalette` / etc. still
 * resolves to a complete `UserSettings` with the correct defaults. Tolerates a
 * non-object / null input by returning the defaults unchanged.
 */
export function mergeUserSettings(stored: unknown): UserSettings {
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_USER_SETTINGS }
  }
  const partial = stored as Partial<UserSettings> & Record<string, unknown>
  const merged = { ...DEFAULT_USER_SETTINGS, ...partial }
  const preset = parseWorkspacePreset(partial.workspacePreset)
  merged.workspacePreset = preset
  // An omitted hide list picks up the Essential first-run default only for Custom
  // (and junk/missing preset, which falls back to Custom). Named presets and
  // Full keep an empty hide list when the key was never stored. An explicit
  // `[]` must stay empty.
  if ('hiddenMenuHrefs' in partial) {
    merged.hiddenMenuHrefs = parseHiddenMenuHrefs(partial.hiddenMenuHrefs)
  } else if (preset === 'custom') {
    merged.hiddenMenuHrefs = [...DEFAULT_USER_SETTINGS.hiddenMenuHrefs]
  } else {
    merged.hiddenMenuHrefs = []
  }
  merged.lastSeenChangelogVersion = parseLastSeenChangelogVersion(
    partial.lastSeenChangelogVersion
  )
  return merged
}

export function parseWorkspacePreset(value: unknown): WorkspacePreset {
  if (
    value === 'full' ||
    value === 'dba' ||
    value === 'engineer' ||
    value === 'sre' ||
    value === 'custom'
  ) {
    return value
  }
  return DEFAULT_USER_SETTINGS.workspacePreset
}

export function parseHiddenMenuHrefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (href): href is string => typeof href === 'string' && href.length > 0
  )
}

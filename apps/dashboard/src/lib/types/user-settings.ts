export type ByteUnit = 'binary' | 'decimal'
export type NumberFormat = 'abbreviated' | 'full'
export type ChartPalette = 'default' | 'colorblind-safe' | 'monochrome'
export type TableDensity = 'comfortable' | 'compact'
export type DefaultTimeRange = '1h' | '6h' | '24h' | '7d' | '30d'

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
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  timezone: Intl?.DateTimeFormat()?.resolvedOptions()?.timeZone || 'UTC',
  theme: 'system',
  byteUnit: 'binary',
  numberFormat: 'abbreviated',
  chartPalette: 'default',
  tableDensity: 'comfortable',
  defaultTimeRange: '24h',
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
  return { ...DEFAULT_USER_SETTINGS, ...(stored as Partial<UserSettings>) }
}

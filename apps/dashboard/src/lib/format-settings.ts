import type { ByteUnit, NumberFormat } from '@/lib/types/user-settings'

/**
 * Module-level snapshot of the format-affecting user settings.
 *
 * The `format-readable` helpers are plain synchronous functions called from
 * hundreds of table cells and chart formatters that cannot each take a React
 * hook. Instead, the user-settings provider syncs the chosen units here once on
 * load and on every change (see `AppearanceSettingsProvider`), and the helpers
 * read this snapshot as their default when no explicit override is passed.
 *
 * Defaults intentionally reproduce the historical behaviour byte-for-byte
 * (binary sizes, abbreviated numbers), so a build that never syncs — SSR / the
 * Worker runtime, or a user who never opens Settings — renders exactly as before.
 */
export interface FormatSettings {
  byteUnit: ByteUnit
  numberFormat: NumberFormat
}

const snapshot: FormatSettings = {
  byteUnit: 'binary',
  numberFormat: 'abbreviated',
}

/** Read the current format settings snapshot. */
export function getFormatSettings(): FormatSettings {
  return snapshot
}

/** Update the format settings snapshot (called by the settings provider). */
export function setFormatSettings(next: Partial<FormatSettings>): void {
  if (next.byteUnit) snapshot.byteUnit = next.byteUnit
  if (next.numberFormat) snapshot.numberFormat = next.numberFormat
}

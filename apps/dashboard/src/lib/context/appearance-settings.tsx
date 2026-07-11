import { useEffect } from 'react'
import { setFormatSettings } from '@/lib/format-settings'
import { useUserSettings } from '@/lib/hooks/use-user-settings'

/**
 * Applies the appearance-related user settings that live outside React's render
 * tree:
 *
 * - **Units** (byte unit + number format) are pushed into the module-level
 *   `format-settings` snapshot that the `format-readable` helpers read.
 * - **Chart palette** and **table density** are applied as `data-*` attributes
 *   on `<html>`, which CSS in `styles.css` keys off. The default value
 *   (`default` palette / `comfortable` density) removes the attribute entirely,
 *   so an untouched install renders exactly as before.
 *
 * Rendered once near the app root; renders nothing.
 */
export function AppearanceSettingsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { settings } = useUserSettings()
  const { byteUnit, numberFormat, chartPalette, tableDensity } = settings

  // Keep the format-readable snapshot in sync with the user's unit choices.
  useEffect(() => {
    setFormatSettings({ byteUnit, numberFormat })
  }, [byteUnit, numberFormat])

  // Chart palette → data-chart-palette on <html> (absent = default palette).
  useEffect(() => {
    const root = document.documentElement
    if (chartPalette && chartPalette !== 'default') {
      root.setAttribute('data-chart-palette', chartPalette)
    } else {
      root.removeAttribute('data-chart-palette')
    }
  }, [chartPalette])

  // Table density → data-density on <html> (absent = comfortable).
  useEffect(() => {
    const root = document.documentElement
    if (tableDensity && tableDensity !== 'comfortable') {
      root.setAttribute('data-density', tableDensity)
    } else {
      root.removeAttribute('data-density')
    }
  }, [tableDensity])

  return children
}

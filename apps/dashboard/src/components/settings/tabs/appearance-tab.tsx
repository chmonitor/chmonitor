import { Palette } from 'lucide-react'

import type { UserSettings } from '@/lib/types/user-settings'

import { PalettePicker } from '../appearance/palette-picker'
import { ThemePicker } from '../appearance/theme-picker'
import { Field } from '../field'
import { SettingsRow } from '../settings-row'
import { TabsContent } from '@/components/ui/tabs'

export function AppearanceTab({
  settings,
  onUpdate,
  onThemeChange,
}: {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
  onThemeChange: (value: UserSettings['theme']) => void
}) {
  return (
    <TabsContent value="appearance" className="space-y-5 px-1 pb-2">
      <SettingsRow label="Theme">
        <ThemePicker value={settings.theme} onChange={onThemeChange} />
      </SettingsRow>

      <Field
        label="Chart palette"
        icon={Palette}
        description="Colour scheme for chart series. Applied to every chart on this browser."
      >
        <PalettePicker
          value={settings.chartPalette}
          onChange={(value) => onUpdate({ chartPalette: value })}
        />
      </Field>
    </TabsContent>
  )
}

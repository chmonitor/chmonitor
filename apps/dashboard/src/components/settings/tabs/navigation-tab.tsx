import { LayoutGrid } from 'lucide-react'

import type { UserSettings } from '@/lib/types/user-settings'

import { Field } from '../field'
import { UnavailablePagesPicker } from '../layout/unavailable-pages-picker'
import { SettingsRow } from '../settings-row'
import { WorkspacePresetPicker } from '../workspace-preset-picker'
import { TabsContent } from '@/components/ui/tabs'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'

export function NavigationTab({
  settings,
  onUpdate,
  focusGroup,
}: {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
  focusGroup?: string
}) {
  const engine = useActiveHostEngine()

  return (
    <TabsContent value="navigation" className="space-y-4 px-1 pb-2">
      <Field
        label="Workspace"
        icon={LayoutGrid}
        description="Hide pages from the sidebar and More. ⌘K still lists them. Full restores every page. Hidden pages stay reachable by URL."
      >
        <WorkspacePresetPicker
          preset={settings.workspacePreset}
          hiddenMenuHrefs={settings.hiddenMenuHrefs}
          engine={engine}
          focusGroup={focusGroup}
          onChange={(next) => onUpdate(next)}
        />
      </Field>

      <div className="space-y-2">
        <SettingsRow label="Unavailable pages">
          <UnavailablePagesPicker
            value={settings.dimUnavailablePages}
            onChange={(dimUnavailablePages) =>
              onUpdate({ dimUnavailablePages })
            }
          />
        </SettingsRow>
        <p className="text-xs text-muted-foreground">
          {settings.dimUnavailablePages
            ? 'Pages whose system table is missing stay in the menu, grayed out (example: Backups).'
            : 'Pages whose system table is missing are removed from the menu entirely.'}
        </p>
      </div>
    </TabsContent>
  )
}

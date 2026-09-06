import { Clock, RotateCcw } from 'lucide-react'

import type { UserSettings } from '@/lib/types/user-settings'

import { Field } from '../field'
import { TimezoneCombobox } from '../timezone-combobox'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'

export function GeneralTab({
  settings,
  onUpdate,
  defaultTimezone,
  isLoadingDefault,
  isUsingDefault,
  onResetTimezone,
}: {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
  defaultTimezone: string | null
  isLoadingDefault: boolean
  isUsingDefault: boolean
  onResetTimezone: () => void
}) {
  return (
    <TabsContent value="general" className="space-y-4 px-1 pb-2">
      <Field
        label="Timezone"
        icon={Clock}
        description="All datetimes will be displayed in your selected timezone"
      >
        {!isLoadingDefault && defaultTimezone && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onResetTimezone}
              disabled={!!isUsingDefault}
            >
              <RotateCcw className="mr-1 size-3" />
              Reset to default
            </Button>
          </div>
        )}
        <TimezoneCombobox
          value={settings.timezone}
          onChange={(timezone) => onUpdate({ timezone })}
          defaultTimezone={defaultTimezone}
        />
      </Field>
    </TabsContent>
  )
}

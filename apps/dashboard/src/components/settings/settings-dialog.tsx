import { Settings } from 'lucide-react'

import type { SettingsTab } from '@/lib/settings-tab'

import { SettingsForm } from './settings-form'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useUserSettings } from '@/lib/hooks/use-user-settings'

interface SettingsDialogProps {
  children?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialTab?: SettingsTab
  focusGroup?: string
}

export function SettingsDialog({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  initialTab = 'general',
  focusGroup,
}: SettingsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const { settings, updateSettings } = useUserSettings()

  // Use controlled state if provided, otherwise use internal state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange || setInternalOpen

  // If using controlled mode, don't render DialogTrigger
  const isControlled = controlledOpen !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!isControlled && (
        <DialogTrigger
          render={
            children || (
              <Button variant="ghost" size="icon" aria-label="Open settings">
                <Settings className="size-4" strokeWidth={1.5} />
              </Button>
            )
          }
        />
      )}
      <DialogContent
        className="flex h-[min(42rem,90vh)] flex-col gap-0 overflow-hidden rounded-xl border bg-card p-0 select-text sm:max-w-4xl"
        data-testid="settings-dialog"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Local to this browser</DialogDescription>
        </DialogHeader>
        <SettingsForm
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => onOpenChange(false)}
          initialTab={initialTab}
          focusGroup={focusGroup}
        />
      </DialogContent>
    </Dialog>
  )
}

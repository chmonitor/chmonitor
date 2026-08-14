import { Settings } from 'lucide-react'

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
}

export function SettingsDialog({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
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
        className="flex h-[min(36rem,85vh)] flex-col overflow-hidden rounded-xl border bg-card select-text sm:max-w-3xl"
        data-testid="settings-dialog"
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="flex items-center gap-2">
            <Settings
              className="size-4 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            Local to this browser
          </DialogDescription>
        </DialogHeader>
        <SettingsForm
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

import { Settings } from 'lucide-react'

import { HealthSettingsPanel } from './health-settings-panel'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function HealthSettingsDialog({
  defaultOpen = false,
}: {
  /** Open the dialog on mount — used by the /health?settings=alerts deep link. */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Settings className="mr-2 size-4" />
        Settings
      </DialogTrigger>
      <DialogContent className="flex h-[min(52rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Health Settings</DialogTitle>
          <DialogDescription>
            Configure per-check thresholds and alert delivery. Settings are
            stored locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <HealthSettingsPanel
          layout="dialog"
          footer={(save) => (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (save()) setOpen(false)
                }}
              >
                Save
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}

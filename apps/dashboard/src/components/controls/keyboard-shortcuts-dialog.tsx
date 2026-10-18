import { SHORTCUTS } from './config/shortcuts-config'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        aria-describedby="shortcuts-description"
      >
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <p id="shortcuts-description" className="sr-only">
          Available keyboard shortcuts for navigating the dashboard
        </p>
        <div
          className="grid gap-2 py-2"
          role="list"
          aria-label="Shortcuts list"
        >
          {SHORTCUTS.map(({ key, description }) => (
            <ShortcutItem
              key={key}
              keyCombination={key}
              description={description}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          On Windows/Linux, use Ctrl instead of ⌘
        </p>
      </DialogContent>
    </Dialog>
  )
}

interface ShortcutItemProps {
  keyCombination: string
  description: string
}

function ShortcutItem({ keyCombination, description }: ShortcutItemProps) {
  return (
    <div
      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted"
      role="listitem"
    >
      <span className="text-sm text-muted-foreground">{description}</span>
      <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
        {keyCombination}
      </kbd>
    </div>
  )
}

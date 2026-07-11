'use client'

/**
 * Floating chat bubble — assistant-ui `AssistantModal`. Mounted app-wide so the
 * ClickHouse agent is reachable from any dashboard page (see
 * `global-assistant-modal.tsx`).
 *
 * Two layouts, remembered per browser (`useAgentWidgetMode`):
 *  - `floating` — the small bottom-right popover (Radix Popover positioning).
 *  - `docked`   — a full-height right sidebar. Because Radix Popper wraps the
 *    popover content in a transformed positioner (which would trap a `fixed`
 *    child), the docked layout is rendered as its own fixed panel OUTSIDE the
 *    Popper. That means we control the Root's `open` state ourselves so the
 *    docked panel can mount/unmount with it (and the Thread stops polling when
 *    closed, same as the popover). Open/close is driven by the bubble trigger
 *    and the header close button — the floating widget's runtime is only ever
 *    run from inside the (already-open) widget, so there's no external
 *    open-on-run-start path to preserve.
 */

import { BotIcon, Minimize2Icon, PanelRightIcon, XIcon } from 'lucide-react'

import { Thread } from './thread'
import { AssistantModalPrimitive } from '@assistant-ui/react'
import { forwardRef, useState } from 'react'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { useAgentWidgetMode } from '@/lib/hooks/use-agent-widget-mode'
import { cn } from '@/lib/utils'

export function AssistantModal() {
  const { isDocked, toggleMode } = useAgentWidgetMode()
  const [open, setOpen] = useState(false)

  const header = (
    <WidgetHeader
      isDocked={isDocked}
      onToggleMode={toggleMode}
      onClose={() => setOpen(false)}
    />
  )

  return (
    <AssistantModalPrimitive.Root open={open} onOpenChange={setOpen}>
      <AssistantModalPrimitive.Anchor className="fixed right-4 bottom-4 z-40 size-11">
        <AssistantModalPrimitive.Trigger asChild>
          <AssistantModalButton />
        </AssistantModalPrimitive.Trigger>
      </AssistantModalPrimitive.Anchor>

      {isDocked ? (
        open && (
          <div
            role="dialog"
            aria-label="ClickHouse Agent"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
            className={cn(
              'bg-popover text-popover-foreground fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(28rem,100vw)] flex-col overflow-hidden border-l shadow-2xl outline-none',
              'animate-in slide-in-from-right-4 duration-200',
              '[&>.aui-root]:rounded-none [&>.aui-root]:border-0'
            )}
          >
            {header}
            <div className="min-h-0 flex-1">
              <Thread />
            </div>
          </div>
        )
      ) : (
        <AssistantModalPrimitive.Content
          sideOffset={16}
          className={cn(
            'bg-popover text-popover-foreground z-50 flex h-[34rem] max-h-[80vh] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border shadow-2xl outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            '[&>.aui-root]:rounded-none [&>.aui-root]:border-0'
          )}
        >
          {header}
          <div className="min-h-0 flex-1">
            <Thread />
          </div>
        </AssistantModalPrimitive.Content>
      )}
    </AssistantModalPrimitive.Root>
  )
}

function WidgetHeader({
  isDocked,
  onToggleMode,
  onClose,
}: {
  isDocked: boolean
  onToggleMode: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <BotIcon className="text-primary size-4" />
      <span className="text-sm font-medium">ClickHouse Agent</span>
      <div className="ml-auto flex items-center">
        <TooltipIconButton
          tooltip={isDocked ? 'Collapse to corner' : 'Dock to side'}
          onClick={onToggleMode}
        >
          {isDocked ? (
            <Minimize2Icon className="size-4" />
          ) : (
            <PanelRightIcon className="size-4" />
          )}
        </TooltipIconButton>
        <TooltipIconButton tooltip="Close" onClick={onClose}>
          <XIcon className="size-4" />
        </TooltipIconButton>
      </div>
    </div>
  )
}

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>

const AssistantModalButton = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { 'data-state': state, ...rest }: ButtonProps & { 'data-state'?: string },
    ref
  ) => {
    const open = state === 'open'
    return (
      <Button
        {...rest}
        ref={ref}
        size="icon"
        aria-label={open ? 'Close agent' : 'Open agent'}
        className="size-11 rounded-full transition-transform hover:scale-105"
      >
        <span
          className={cn(
            'absolute transition-all',
            open ? 'rotate-90 scale-0' : 'rotate-0 scale-100'
          )}
        >
          <BotIcon className="size-5" />
        </span>
        <span
          className={cn(
            'absolute transition-all',
            open ? 'rotate-0 scale-100' : 'rotate-90 scale-0'
          )}
        >
          <XIcon className="size-5" />
        </span>
      </Button>
    )
  }
)
AssistantModalButton.displayName = 'AssistantModalButton'

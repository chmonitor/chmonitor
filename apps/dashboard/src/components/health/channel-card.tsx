import { ChevronDown, Plus } from 'lucide-react'

import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/**
 * Shared presentation for one alert delivery channel on the alert-settings
 * grid: a compact summary row (icon, name, status badge, optional enable
 * switch, chevron) that expands into the channel's configuration form.
 *
 * Deliberately dumb — it owns no channel state. The browser-local channels
 * (localStorage, saved by the page footer) and the server channels (per-card
 * save to D1) both render through it while keeping their own save semantics.
 */
export function ChannelCard({
  icon,
  title,
  badges,
  status,
  enabled,
  onEnabledChange,
  switchDisabled,
  defaultOpen,
  children,
}: {
  icon: ReactNode
  title: string
  /** Extra badges rendered next to the status pill (e.g. "env", "secret set"). */
  badges?: ReactNode
  /** Short state line, e.g. "Enabled · Critical only". */
  status: string
  /** Omit to render a card with no enable switch. */
  enabled?: boolean
  onEnabledChange?: (checked: boolean) => void
  switchDisabled?: boolean
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/channel flex flex-col rounded-xl border bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 p-3">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{title}</span>
              {badges}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {status}
            </span>
          </span>
          <ChevronDown
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-open/channel:rotate-180"
            strokeWidth={1.5}
          />
        </CollapsibleTrigger>
        {onEnabledChange && (
          <Switch
            checked={enabled ?? false}
            onCheckedChange={onEnabledChange}
            disabled={switchDisabled}
            aria-label={`Enable ${title}`}
          />
        )}
      </div>
      <CollapsibleContent className="overflow-hidden">
        <div className="flex flex-col gap-2 border-t p-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Compact offer tile for a channel that is not configured yet. Clicking it
 * opens the channel's full card (the caller moves the id into its "opened"
 * set), so an unconfigured deployment shows a short menu instead of a wall of
 * blank forms.
 */
export function AddChannelTile({
  icon,
  title,
  description,
  example,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  /** Example target value, e.g. a sample Slack webhook URL. */
  example?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-dashed bg-card/50 p-3 text-left',
        'transition-colors hover:border-solid hover:bg-muted/50',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          <Plus className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
        </span>
        <span className="text-xs text-muted-foreground">{description}</span>
        {example && (
          <code className="truncate text-[11px] text-muted-foreground/80">
            {example}
          </code>
        )}
      </span>
    </button>
  )
}

/**
 * Dialog listing every channel that is not configured yet.
 *
 * The add-tiles used to sit inline under the configured grid, which put a
 * permanent menu of things-you-are-not-using on a settings page whose job is to
 * show what IS set up. Behind a dialog the page stays short, and the picker gets
 * room to describe each channel properly.
 */
export function ChannelPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  items: readonly {
    id: string
    label: string
    description: string
    icon: ReactNode
    example?: string
  }[]
  onPick: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
          {items.map((item) => (
            <AddChannelTile
              key={item.id}
              icon={item.icon}
              title={item.label}
              description={item.description}
              example={item.example}
              onClick={() => {
                onPick(item.id)
                onOpenChange(false)
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Section header shared by the channel groups (matches the paired-section idiom). */
export function ChannelSectionHeader({
  icon,
  title,
  description,
  count,
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  count?: number
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {count !== undefined && (
          <Badge variant="outline" className="text-xs">
            {count}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

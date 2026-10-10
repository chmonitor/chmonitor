'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  Cable,
  ChevronRight,
  Mails,
  MoonStar,
  Route,
  Sparkles,
  Webhook,
  Wrench,
} from 'lucide-react'

import type { ReactNode } from 'react'
import type {
  AdvancedGroupId,
  AdvancedSectionId,
} from '@/lib/health/health-settings-tabs'

import { AlertRoutingPanel } from './alert-routing-dialog'
import { AlertSuggestionsPanel } from './alert-suggestions-panel'
import { DigestSettingsPanel } from './digest-settings-panel'
import { MaintenanceWindowsPanel } from './maintenance-windows-panel'
import { PeerDBRulesPanel } from './peerdb-rules-panel'
import { QuietHoursPanel } from './quiet-hours-panel'
import { RuleBuilderPanel } from './rule-builder'
import { WebhookSubscriptionsPanel } from './webhook-subscriptions-panel'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * The seven alerting surfaces that used to sit together behind the Advanced
 * tab, each a launcher card that opens its panel in a dialog.
 *
 * #3438 sorts them into three groups by what they do, and renders each group
 * next to the thing it belongs with (placement lives in
 * `ADVANCED_SECTION_PLACEMENT`): `define` under the built-in alert list,
 * `delivery` under the channels, `silencing` on the Advanced tab. Nothing is
 * removed — each panel renders unchanged (its own write-capability notice and
 * source badges included), and every old `?tab=` deep link still opens the
 * right dialog on whichever tab now hosts it.
 */
interface AdvancedSection {
  id: AdvancedSectionId
  title: string
  description: string
  icon: LucideIcon
  group: AdvancedGroupId
  /** Wider dialog for the panels that render tables/forms side by side. */
  wide?: boolean
  render: () => ReactNode
}

export const ADVANCED_SECTIONS: readonly AdvancedSection[] = [
  {
    id: 'routing',
    group: 'delivery',
    title: 'Routing rules',
    description:
      'Send specific checks or severities to specific channels instead of everything to everyone.',
    icon: Route,
    wide: true,
    render: () => <AlertRoutingPanel />,
  },
  {
    id: 'webhooks',
    group: 'delivery',
    title: 'Webhook subscriptions',
    description:
      'Server-side subscriptions that POST alert events to your own endpoints.',
    icon: Webhook,
    wide: true,
    render: () => <WebhookSubscriptionsPanel />,
  },
  {
    id: 'quiet-hours',
    group: 'silencing',
    title: 'Quiet hours',
    description:
      'Hold non-critical alerts during a recurring window — nights, weekends.',
    icon: MoonStar,
    render: () => <QuietHoursPanel />,
  },
  {
    id: 'maintenance',
    group: 'silencing',
    title: 'Maintenance windows',
    description:
      'Suppress alerts entirely for a planned window, so a migration does not page anyone.',
    icon: Wrench,
    render: () => <MaintenanceWindowsPanel />,
  },
  {
    id: 'digest',
    group: 'delivery',
    title: 'Digest',
    description:
      'Batch alerts into a periodic summary instead of one message per event.',
    icon: Mails,
    render: () => <DigestSettingsPanel />,
  },
  {
    id: 'suggested',
    group: 'define',
    title: 'Suggested alerts',
    description:
      'Threshold suggestions derived from how this cluster has actually behaved.',
    icon: Sparkles,
    wide: true,
    render: () => <AlertSuggestionsPanel />,
  },
  {
    id: 'custom-rules',
    group: 'define',
    title: 'Custom rules',
    description:
      'Build a rule on any metric with your own comparison and window.',
    icon: Braces,
    wide: true,
    render: () => <RuleBuilderPanel />,
  },
  {
    id: 'peerdb-rules',
    group: 'define',
    title: 'PeerDB mirror rules',
    description:
      'Per-mirror lag, slot lag, error and stale-sync thresholds, or mute a mirror for a while.',
    icon: Cable,
    wide: true,
    render: () => <PeerDBRulesPanel />,
  },
]

export const ADVANCED_GROUPS: Readonly<
  Record<AdvancedGroupId, { title: string; description: string }>
> = {
  define: {
    title: 'More ways to alert',
    description:
      'Add alerts beyond the built-in list — suggested from this cluster, or your own rule on any metric.',
  },
  delivery: {
    title: 'Delivery',
    description:
      'Decide which alerts reach which channel, forward events to your own endpoints, or batch them into a digest.',
  },
  silencing: {
    title: 'Silencing',
    description:
      'Hold alerts back on purpose — a recurring quiet window or a planned maintenance.',
  },
}

/**
 * One group of launcher cards plus the dialog they open. `initialSection` is
 * ignored unless it belongs to this group, so every group on a tab can be
 * handed the same resolved deep link.
 */
export function AlertSectionGroup({
  group,
  initialSection,
}: {
  group: AdvancedGroupId
  /** Opened on mount — how a legacy `?tab=routing` deep link still works. */
  initialSection?: AdvancedSectionId
}) {
  const sections = ADVANCED_SECTIONS.filter((s) => s.group === group)
  const own = sections.some((s) => s.id === initialSection)
    ? initialSection
    : undefined
  const [openId, setOpenId] = useState<AdvancedSectionId | undefined>(own)

  // Follow the URL when the deep link changes without a remount.
  useEffect(() => {
    if (own) setOpenId(own)
  }, [own])

  const active = sections.find((section) => section.id === openId)
  const meta = ADVANCED_GROUPS[group]

  return (
    <section className="flex flex-col gap-3" data-alert-group={group}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-foreground">{meta.title}</h2>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setOpenId(section.id)}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border bg-card p-3 text-left shadow-sm',
                'transition-colors hover:bg-muted/40',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" strokeWidth={1.5} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{section.title}</span>
                <span className="text-xs text-muted-foreground">
                  {section.description}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
              />
            </button>
          )
        })}
      </div>

      <Dialog
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) setOpenId(undefined)
        }}
      >
        <DialogContent
          className={cn(
            'max-h-[85vh] overflow-y-auto',
            active?.wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
          )}
        >
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-1.5">
                  <active.icon className="size-4" strokeWidth={1.5} />
                  {active.title}
                </DialogTitle>
                <DialogDescription>{active.description}</DialogDescription>
              </DialogHeader>
              {active.render()}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** The Advanced tab: now only the silencing group. */
export function AdvancedSettingsPanel({
  initialSection,
}: {
  initialSection?: AdvancedSectionId
}) {
  return <AlertSectionGroup group="silencing" initialSection={initialSection} />
}

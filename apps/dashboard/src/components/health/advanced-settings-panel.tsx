'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  ChevronRight,
  Mails,
  MoonStar,
  Route,
  Sparkles,
  Webhook,
  Wrench,
} from 'lucide-react'

import type { ReactNode } from 'react'
import type { AdvancedSectionId } from '@/lib/health/health-settings-tabs'

import { AlertRoutingPanel } from './alert-routing-dialog'
import { AlertSuggestionsPanel } from './alert-suggestions-panel'
import { DigestSettingsPanel } from './digest-settings-panel'
import { MaintenanceWindowsPanel } from './maintenance-windows-panel'
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
 * Every advanced alerting surface, as one grid of cards that each open a dialog.
 *
 * These six panels used to be six top-level tabs, which made a settings page
 * with ten tabs where most operators only ever touch two. Nothing is removed —
 * each panel renders unchanged inside its dialog, and its old `?tab=` deep link
 * still lands here with the right dialog already open (the ids below match the
 * `advancedSection` values in `LEGACY_TAB_MAP`).
 */
interface AdvancedSection {
  id: AdvancedSectionId
  title: string
  description: string
  icon: LucideIcon
  /** Wider dialog for the panels that render tables/forms side by side. */
  wide?: boolean
  render: () => ReactNode
}

export const ADVANCED_SECTIONS: readonly AdvancedSection[] = [
  {
    id: 'routing',
    title: 'Routing rules',
    description:
      'Send specific checks or severities to specific channels instead of everything to everyone.',
    icon: Route,
    wide: true,
    render: () => <AlertRoutingPanel />,
  },
  {
    id: 'webhooks',
    title: 'Webhook subscriptions',
    description:
      'Server-side subscriptions that POST alert events to your own endpoints.',
    icon: Webhook,
    wide: true,
    render: () => <WebhookSubscriptionsPanel />,
  },
  {
    id: 'quiet-hours',
    title: 'Quiet hours',
    description:
      'Hold non-critical alerts during a recurring window — nights, weekends.',
    icon: MoonStar,
    render: () => <QuietHoursPanel />,
  },
  {
    id: 'maintenance',
    title: 'Maintenance windows',
    description:
      'Suppress alerts entirely for a planned window, so a migration does not page anyone.',
    icon: Wrench,
    render: () => <MaintenanceWindowsPanel />,
  },
  {
    id: 'digest',
    title: 'Digest',
    description:
      'Batch alerts into a periodic summary instead of one message per event.',
    icon: Mails,
    render: () => <DigestSettingsPanel />,
  },
  {
    id: 'suggested',
    title: 'Suggested alerts',
    description:
      'Threshold suggestions derived from how this cluster has actually behaved.',
    icon: Sparkles,
    wide: true,
    render: () => <AlertSuggestionsPanel />,
  },
  {
    id: 'custom-rules',
    title: 'Custom rules',
    description:
      'Build a rule on any metric with your own comparison and window.',
    icon: Braces,
    wide: true,
    render: () => <RuleBuilderPanel />,
  },
]

export function AdvancedSettingsPanel({
  initialSection,
}: {
  /** Opened on mount — how a legacy `?tab=routing` deep link still works. */
  initialSection?: AdvancedSectionId
}) {
  const [openId, setOpenId] = useState<AdvancedSectionId | undefined>(
    initialSection
  )

  // Follow the URL when the deep link changes without a remount.
  useEffect(() => {
    if (initialSection) setOpenId(initialSection)
  }, [initialSection])

  const active = ADVANCED_SECTIONS.find((section) => section.id === openId)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-foreground">Advanced</h2>
        <p className="text-xs text-muted-foreground">
          Everything that shapes when and where an alert is delivered. Each
          opens in its own dialog.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {ADVANCED_SECTIONS.map((section) => {
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
    </div>
  )
}

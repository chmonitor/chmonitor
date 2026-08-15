'use client'

import type { LucideIcon } from 'lucide-react'
import { Check, Layers, MoonStar, Shield, Siren, Sparkles } from 'lucide-react'

import type { AlertSettings } from '@/lib/health/alert-settings-storage'
import type { AlertTemplate } from '@/lib/health/alert-templates'
import type { ThresholdsMap } from '@/lib/health/thresholds-storage'

import { HEALTH_CHECKS } from './health-checks'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ALERT_TEMPLATES, applyTemplate } from '@/lib/health/alert-templates'
import { cn } from '@/lib/utils'

const TEMPLATE_ICONS: Record<AlertTemplate['icon'], LucideIcon> = {
  shield: Shield,
  siren: Siren,
  layers: Layers,
  moon: MoonStar,
}

/**
 * Quick-start template picker.
 *
 * Picking a template writes a severity floor, the browser-notification toggle
 * and a set of thresholds into the page's in-memory state — the operator still
 * presses Save, and can retune anything afterwards. Channel targets are never
 * overwritten (see `applyTemplate`).
 */
export function AlertTemplateDialog({
  open,
  onOpenChange,
  alerts,
  thresholds,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  alerts: AlertSettings
  thresholds: ThresholdsMap
  onApply: (next: { alerts: AlertSettings; thresholds: ThresholdsMap }) => void
}) {
  const [selected, setSelected] = useState<string>(ALERT_TEMPLATES[0].id)
  const template =
    ALERT_TEMPLATES.find((t) => t.id === selected) ?? ALERT_TEMPLATES[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="size-4" strokeWidth={1.5} />
            Start from a template
          </DialogTitle>
          <DialogDescription>
            A template sets the severity floor and thresholds for you.
            Everything stays editable — it is a starting point, not a lock-in.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          {ALERT_TEMPLATES.map((item) => {
            const Icon = TEMPLATE_ICONS[item.icon]
            const isSelected = item.id === selected
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelected(item.id)}
                className={cn(
                  'flex flex-col gap-1.5 rounded-xl border-2 p-3 text-left transition-colors',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-muted bg-card hover:bg-muted/40'
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" strokeWidth={1.5} />
                  </span>
                  <span className="text-sm font-medium">{item.name}</span>
                  {isSelected && (
                    <Check
                      className="ml-auto size-4 text-primary"
                      strokeWidth={1.5}
                    />
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.description}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
          <span className="text-xs font-medium">
            “{template.name}” will set
          </span>
          <ul className="flex flex-col gap-0.5">
            {template.highlights.map((line) => (
              <li
                key={line}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Check className="size-3 shrink-0" strokeWidth={1.5} />
                {line}
              </li>
            ))}
          </ul>
          <span className="text-[11px] text-muted-foreground">
            Webhook and healthchecks.io targets are left untouched.
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(
                applyTemplate(template, { alerts, thresholds }, HEALTH_CHECKS)
              )
              onOpenChange(false)
            }}
          >
            Apply template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

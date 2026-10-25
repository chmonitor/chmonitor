'use client'

import type { InsightsSettingsUpdate } from './use-insights-settings-form'

import { TEMPLATE_SVG } from './icons'
import { Label } from '@/components/ui/label'
import {
  INSIGHT_TEMPLATES,
  type InsightTemplateId,
} from '@/lib/insights/templates'
import { cn } from '@/lib/utils'

export function TemplatesSection({
  activeTemplate,
  update,
}: {
  activeTemplate: InsightTemplateId | null
  update: InsightsSettingsUpdate
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Templates
      </Label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {INSIGHT_TEMPLATES.map((t) => {
          const TemplateIcon = TEMPLATE_SVG[t.icon]
          const active = activeTemplate === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => update(t.settings)}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5 dark:border-primary/30 dark:bg-primary/[0.08]'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <TemplateIcon
                className={cn(
                  active
                    ? 'text-primary dark:text-primary/90'
                    : 'text-muted-foreground'
                )}
              />
              <span className="text-sm font-medium leading-none">
                {t.label}
              </span>
              <span className="text-[11px] max-sm:text-xs text-muted-foreground">
                {t.hint}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

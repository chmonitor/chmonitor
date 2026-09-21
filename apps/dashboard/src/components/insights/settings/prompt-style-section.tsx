'use client'

/**
 * Prompt style — segmented icon control (concise / detailed / beginner).
 *
 * Extracted from `insights-settings-form.tsx`.
 */

import { FileText } from 'lucide-react'

import type { InsightsSettings } from '@/lib/insights/settings'
import type { InsightsSettingsUpdate } from './use-insights-settings-form'

import { STYLE_ICONS } from './icons'
import { Label } from '@/components/ui/label'
import { INSIGHT_PROMPT_STYLES } from '@/lib/insights/prompts'
import { cn } from '@/lib/utils'

export function PromptStyleSection({
  settings,
  update,
  off,
}: {
  settings: InsightsSettings
  update: InsightsSettingsUpdate
  off: boolean
}) {
  return (
    <div className={cn('space-y-2', off && 'pointer-events-none opacity-50')}>
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        <FileText className="size-3.5 text-muted-foreground" />
        Prompt style
      </Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {INSIGHT_PROMPT_STYLES.map((s) => {
          const Icon = STYLE_ICONS[s.id]
          const active = settings.promptStyle === s.id
          return (
            <button
              key={s.id}
              type="button"
              disabled={off}
              onClick={() => update({ promptStyle: s.id })}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5 dark:border-primary/30 dark:bg-primary/[0.08]'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <Icon
                className={cn(
                  'size-4',
                  active
                    ? 'text-primary dark:text-primary/90'
                    : 'text-muted-foreground'
                )}
              />
              <span className="text-xs font-medium">{s.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

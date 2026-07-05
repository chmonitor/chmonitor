'use client'

/**
 * Model picker + lookback window — 2-col grid.
 *
 * Extracted from `insights-settings-form.tsx`.
 */

import { Clock, Cpu, ExternalLink } from 'lucide-react'

import type { ModelDisplayInfo } from '@/lib/hooks/use-agent-model'
import type { InsightsSettings } from '@/lib/insights/settings'
import type { InsightsSettingsUpdate } from './use-insights-settings-form'

import { ModelCombobox } from './model-combobox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { INSIGHT_WINDOWS } from '@/lib/insights/settings'
import { cn } from '@/lib/utils'

export function ModelWindowSection({
  settings,
  update,
  models,
  defaultModelLabel,
  off,
  docsProviderUrl,
}: {
  settings: InsightsSettings
  update: InsightsSettingsUpdate
  models: readonly ModelDisplayInfo[]
  defaultModelLabel: string | undefined
  off: boolean
  docsProviderUrl: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div
        className={cn('space-y-1.5', off && 'pointer-events-none opacity-50')}
      >
        <Label className="flex items-center justify-between gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            <Cpu className="size-3.5 text-muted-foreground" />
            Model
          </span>
          <a
            href={docsProviderUrl}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={off ? -1 : undefined}
            className="flex items-center gap-0.5 text-[10px] font-normal text-muted-foreground hover:text-foreground transition-colors"
          >
            Providers
            <ExternalLink className="size-2.5" />
          </a>
        </Label>
        <ModelCombobox
          value={settings.model}
          models={models}
          defaultModelLabel={defaultModelLabel}
          disabled={off}
          onValueChange={(value) => update({ model: value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="size-3.5 text-muted-foreground" />
          Lookback
        </Label>
        <Select
          value={settings.window}
          onValueChange={(value) => update({ window: value ?? undefined })}
        >
          <SelectTrigger className="w-full" aria-label="Lookback window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSIGHT_WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

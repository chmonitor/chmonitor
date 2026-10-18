'use client'

import { AlertTriangle, ExternalLink } from 'lucide-react'

import type { InsightsSettings } from '@/lib/insights/settings'
import type { InsightsSettingsUpdate } from './use-insights-settings-form'

import { EnhanceGlyph } from './icons'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function EnhanceSection({
  settings,
  update,
  enrichmentUnavailable,
  docsProviderUrl,
}: {
  settings: InsightsSettings
  update: InsightsSettingsUpdate
  enrichmentUnavailable: boolean
  docsProviderUrl: string
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
            <EnhanceGlyph className="text-foreground/70" />
          </span>
          <div className="leading-tight">
            <Label htmlFor="insights-enrich" className="text-sm font-medium">
              Enhance with AI
            </Label>
            <p className="text-xs text-muted-foreground">
              Rewrite signals into clear, actionable insights.
            </p>
          </div>
        </div>
        <Switch
          id="insights-enrich"
          checked={settings.enrich}
          onCheckedChange={(checked) => update({ enrich: checked })}
        />
      </div>

      {enrichmentUnavailable ? (
        <div className="space-y-1.5 rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2.5">
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              No LLM provider configured — deterministic copy will be shown. Set
              a provider key (e.g.{' '}
              <code className="rounded bg-amber-500/15 px-0.5 font-mono text-[10px]">
                OPENROUTER_API_KEY
              </code>{' '}
              or{' '}
              <code className="rounded bg-amber-500/15 px-0.5 font-mono text-[10px]">
                ANYROUTER_API_KEY
              </code>
              ).
            </span>
          </div>
          <a
            href={docsProviderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-5.5 inline-flex items-center gap-1 text-[11px] text-amber-700/80 hover:text-amber-700 dark:text-amber-400/80 dark:hover:text-amber-400 underline underline-offset-2"
          >
            Configure a provider
            <ExternalLink className="size-3" />
          </a>
        </div>
      ) : null}
    </>
  )
}

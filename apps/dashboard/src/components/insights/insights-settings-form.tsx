'use client'

/**
 * AI Insights settings form — template-first, searchable model picker.
 *
 * Per-user insight preferences persisted by `useInsightsSettings`: enrichment,
 * model, prompt tone, and lookback window. Operators can one-click a template
 * (Quick scan / Deep dive / Learning / Raw) or fine-tune the individual
 * controls. The available model list comes from the same source as the agent
 * model picker (configured providers only). Changes apply immediately.
 *
 * This component is a thin composition of section sub-forms in `./settings/*`;
 * all data + derived state lives in `useInsightsSettingsForm`.
 */

import { RotateCcw } from 'lucide-react'

import { EnhanceSection } from './settings/enhance-section'
import { ModelWindowSection } from './settings/model-window-section'
import { PromptStyleSection } from './settings/prompt-style-section'
import { TemplatesSection } from './settings/templates-section'
import { useInsightsSettingsForm } from './settings/use-insights-settings-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function InsightsSettingsForm({ className }: { className?: string }) {
  const {
    settings,
    update,
    reset,
    models,
    status,
    enrichmentUnavailable,
    off,
    activeTemplate,
    docsProviderUrl,
  } = useInsightsSettingsForm()

  return (
    <Card className={cn(className)}>
      <CardContent className="space-y-5 pt-6">
        {/* Templates — pick a vibe in one click */}
        <TemplatesSection activeTemplate={activeTemplate} update={update} />

        <EnhanceSection
          settings={settings}
          update={update}
          enrichmentUnavailable={enrichmentUnavailable}
          docsProviderUrl={docsProviderUrl}
        />

        <PromptStyleSection settings={settings} update={update} off={off} />

        <ModelWindowSection
          settings={settings}
          update={update}
          models={models}
          defaultModelLabel={status?.defaultModel}
          off={off}
          docsProviderUrl={docsProviderUrl}
        />

        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={reset}
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

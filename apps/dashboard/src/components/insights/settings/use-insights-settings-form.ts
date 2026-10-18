'use client'

import { useQuery } from '@tanstack/react-query'

import type { ModelDisplayInfo } from '@/lib/hooks/use-agent-model'
import type { InsightsSettings } from '@/lib/insights/settings'
import type { InsightTemplate } from '@/lib/insights/templates'

import { docsSiteUrl } from '@/lib/docs-site'
import { useAgentModel } from '@/lib/hooks/use-agent-model'
import { matchTemplate } from '@/lib/insights/templates'
import { useInsightsSettings } from '@/lib/query/use-insights-settings'
import { apiFetch } from '@/lib/swr/api-fetch'

export interface InsightsStatus {
  enrichmentAvailable: boolean
  defaultModel: string
}

/** Merge a partial update, persist, and broadcast. */
export type InsightsSettingsUpdate = (patch: Partial<InsightsSettings>) => void

export interface UseInsightsSettingsFormResult {
  settings: InsightsSettings
  update: InsightsSettingsUpdate
  reset: () => void
  models: readonly ModelDisplayInfo[]
  status: InsightsStatus | undefined
  /** True when enrichment is on but no provider is configured server-side. */
  enrichmentUnavailable: boolean
  /** True when enrichment is off — sections dependent on it should dim. */
  off: boolean
  /** The template id currently matching the settings, if any. */
  activeTemplate: InsightTemplate['id'] | null
  /** Docs link for configuring an LLM provider. */
  docsProviderUrl: string
}

export function useInsightsSettingsForm(): UseInsightsSettingsFormResult {
  const { settings, update, reset } = useInsightsSettings()
  const { models } = useAgentModel()

  const { data: status } = useQuery<InsightsStatus>({
    queryKey: ['/api/v1/insights/status'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/insights/status')
      if (!res.ok) throw new Error('Failed to fetch insights status')
      return res.json()
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const enrichmentUnavailable =
    settings.enrich && status?.enrichmentAvailable === false

  return {
    settings,
    update,
    reset,
    models,
    status,
    enrichmentUnavailable: Boolean(enrichmentUnavailable),
    off: !settings.enrich,
    activeTemplate: matchTemplate(settings),
    docsProviderUrl: docsSiteUrl('ai-agent'),
  }
}

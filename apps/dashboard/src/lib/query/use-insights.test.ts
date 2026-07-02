/**
 * useInsights generation-params contract.
 *
 * The auto (mount-time) generation must NOT spend an LLM enrichment call, while
 * the explicit "Refresh" button must honour the user's saved enrich setting.
 * Both paths funnel through the mutation's param builder; this test exercises the
 * exact `auto` override the hook applies (see `use-insights.ts`
 * `generateMutation.mutationFn`) against the real `generateParamsFromSettings`,
 * mirroring the effect-body replication pattern in `provider.test.tsx`.
 */

import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_INSIGHTS_SETTINGS,
  generateParamsFromSettings,
  type InsightsSettings,
} from '@/lib/insights/settings'

// Exact transform from use-insights.ts: the auto path forces enrich=false, the
// manual Refresh path passes the saved settings through untouched.
function buildGenerateParams(
  hostId: number,
  settings: InsightsSettings,
  { auto }: { auto: boolean }
): URLSearchParams {
  const effectiveSettings = auto ? { ...settings, enrich: false } : settings
  return new URLSearchParams(
    generateParamsFromSettings(hostId, effectiveSettings)
  )
}

describe('useInsights generation params', () => {
  const hostId = 0

  it('auto path requests enrich=false even when the user setting has enrich on', () => {
    // Default settings have enrich: true — the auto path must still opt out.
    expect(DEFAULT_INSIGHTS_SETTINGS.enrich).toBe(true)

    const params = buildGenerateParams(hostId, DEFAULT_INSIGHTS_SETTINGS, {
      auto: true,
    })

    expect(params.get('enrich')).toBe('false')
    // Enrichment tuning params are dropped when enrichment is off.
    expect(params.get('model')).toBeNull()
    expect(params.get('promptStyle')).toBeNull()
  })

  it('manual Refresh path keeps enrichment on (no enrich=false) for enrich:true settings', () => {
    const params = buildGenerateParams(hostId, DEFAULT_INSIGHTS_SETTINGS, {
      auto: false,
    })

    // enrich stays on: the param is only emitted to force it OFF.
    expect(params.get('enrich')).toBeNull()
  })

  it('manual Refresh path forwards the model when the user picked one', () => {
    const settings: InsightsSettings = {
      ...DEFAULT_INSIGHTS_SETTINGS,
      enrich: true,
      model: 'openai:gpt-4o-mini',
    }

    const auto = buildGenerateParams(hostId, settings, { auto: true })
    const manual = buildGenerateParams(hostId, settings, { auto: false })

    // Auto opts out of enrichment, so it must not spend a model call.
    expect(auto.get('enrich')).toBe('false')
    expect(auto.get('model')).toBeNull()

    // Manual honours the user's enrichment model.
    expect(manual.get('enrich')).toBeNull()
    expect(manual.get('model')).toBe('openai:gpt-4o-mini')
  })

  it('does not mutate the caller settings when forcing enrich off', () => {
    const settings: InsightsSettings = { ...DEFAULT_INSIGHTS_SETTINGS }
    buildGenerateParams(hostId, settings, { auto: true })
    // The saved setting is untouched — only the request opts out.
    expect(settings.enrich).toBe(true)
  })
})

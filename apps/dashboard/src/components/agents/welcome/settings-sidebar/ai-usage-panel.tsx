'use client'

import { StaticSectionHeader } from './static-section-header'
import {
  AiUsageMeter,
  AiUsageMeterBadge,
} from '@/components/agents/welcome/ai-usage-meter'
import { useAiQuota } from '@/lib/ai/agent/use-ai-quota'

/**
 * Compact "X / N messages today" meter for the daily AI allowance. Cloud-only:
 * {@link useAiQuota} resolves `show: false` on OSS, for unlimited plans, and on
 * any endpoint error/absence, so this renders nothing outside the cloud Free/Pro
 * tiers with a bounded quota.
 */
export function AiUsagePanel() {
  const quota = useAiQuota()
  // Gate the whole section on visibility so an empty "Daily AI usage" header
  // never shows on OSS / unlimited plans; the meter itself is the shared
  // rendering (issue #2809).
  if (!quota.show || quota.limit === null) return null

  return (
    <div className="mb-3">
      <StaticSectionHeader
        label="Daily AI usage"
        right={<AiUsageMeterBadge />}
      />
      <AiUsageMeter variant="panel" />
    </div>
  )
}

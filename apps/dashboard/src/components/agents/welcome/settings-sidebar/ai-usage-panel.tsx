'use client'

import { GaugeIcon } from 'lucide-react'

import { CollapsibleSidebarSection } from './collapsible-sidebar-section'
import {
  AiUsageMeter,
  AiUsageMeterBadge,
} from '@/components/agents/welcome/ai-usage-meter'
import { useAiQuota } from '@/lib/ai/agent/use-ai-quota'

/**
 * Collapsible "X / N messages today" meter for the daily AI allowance, and the
 * one section left open on arrival. Cloud-only: {@link useAiQuota} resolves
 * `show: false` on OSS, for unlimited plans, and on any endpoint error/absence,
 * so this renders nothing outside the cloud Free/Pro tiers with a bounded
 * quota.
 */
export function AiUsagePanel() {
  const quota = useAiQuota()
  // Gate the whole section on visibility so a header with a dangling chevron
  // and no body never shows on OSS / unlimited plans; the meter itself is the
  // shared rendering (issue #2809).
  if (!quota.show || quota.limit === null) return null

  return (
    <CollapsibleSidebarSection
      label="Daily AI usage"
      icon={GaugeIcon}
      right={<AiUsageMeterBadge />}
    >
      <AiUsageMeter variant="panel" />
    </CollapsibleSidebarSection>
  )
}

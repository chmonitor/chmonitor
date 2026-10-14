import { createFileRoute } from '@tanstack/react-router'

import { AgentsPageClient } from '@/components/agents/agents-page-client'
import { pageOgHead } from '@/lib/og'
import { useFeatureTracking } from '@/lib/telemetry'

function AgentsPage() {
  useFeatureTracking('agents')
  return <AgentsPageClient />
}

export const Route = createFileRoute('/(dashboard)/agents/')({
  component: AgentsPage,
  head: () => pageOgHead('agents'),
})

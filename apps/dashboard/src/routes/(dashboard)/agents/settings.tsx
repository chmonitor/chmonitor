import { createFileRoute } from '@tanstack/react-router'

import { AgentSettingsPage } from '@/components/agents/settings/agent-settings-page'
import { pageOgHead } from '@/lib/og'

export const Route = createFileRoute('/(dashboard)/agents/settings')({
  component: AgentSettingsPage,
  head: () => pageOgHead('agents/settings'),
})

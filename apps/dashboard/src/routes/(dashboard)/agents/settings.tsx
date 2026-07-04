import { createFileRoute } from '@tanstack/react-router'

import { AgentSettingsPage } from '@/components/agents/settings/agent-settings-page'

export const Route = createFileRoute('/(dashboard)/agents/settings')({
  component: AgentSettingsPage,
})

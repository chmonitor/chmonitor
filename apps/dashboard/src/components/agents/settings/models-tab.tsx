'use client'

/**
 * Models tab — `/agents/settings`.
 *
 * Reuses {@link AgentModelPicker} (the same picker rendered on the welcome
 * toolbar and the chat sidebar) so model selection stays in one place.
 */

import { AgentModelPicker } from '@/components/agents/welcome/agent-model-picker'

export function ModelsTab() {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-[11.5px] leading-snug">
        Choose which model the agent uses for new conversations. Saved to this
        browser; existing conversations keep the model they started with.
      </p>
      <AgentModelPicker variant="panel" />
    </div>
  )
}

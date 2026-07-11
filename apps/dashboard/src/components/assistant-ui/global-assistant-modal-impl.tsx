'use client'

/**
 * Implementation of the app-wide floating agent. Kept in a separate module so
 * it can be lazy-loaded via `React.lazy` — that keeps assistant-ui out of the
 * Cloudflare Worker server bundle (3 MiB limit).
 */

import { AgentRuntimeProvider } from '@/components/assistant-ui/agent-runtime-provider'
import { AssistantModal } from '@/components/assistant-ui/assistant-modal'
import { PageContextControlProvider } from '@/components/assistant-ui/page-context-control'

export function GlobalAssistantModalImpl() {
  return (
    <PageContextControlProvider>
      <AgentRuntimeProvider>
        <AssistantModal />
      </AgentRuntimeProvider>
    </PageContextControlProvider>
  )
}

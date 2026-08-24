'use client'

/**
 * Shared "send this suggested question" handler for the agent welcome grid
 * and the settings-sidebar prompt list.
 */

import { useAui } from '@assistant-ui/react'
import { useCallback } from 'react'
import { useAgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { track } from '@/lib/telemetry'

export function useStartAgentPrompt(onStarted?: () => void) {
  const aui = useAui()
  const { ensureAuthed } = useAgentAuthGate()

  return useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim()
      if (!trimmed) return
      if (!ensureAuthed()) return
      onStarted?.()
      aui.thread.append({
        role: 'user',
        content: [{ type: 'text', text: trimmed }],
      })
      track('ai_query_sent')
    },
    [aui, ensureAuthed, onStarted]
  )
}

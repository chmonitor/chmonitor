'use client'

import { LoaderCircleIcon } from 'lucide-react'

import { useAuiState } from '@assistant-ui/react'
import { Marker, MarkerIcon } from '@/components/ui/marker'

export function LoadingIndicator() {
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const hasError = useAuiState(
    (s) =>
      s.message.role === 'assistant' &&
      (s.message.status?.type === 'incomplete' ||
        s.message.content.some(
          (p) => (p as { type?: string })?.type === 'data-error'
        ))
  )
  const hasNoParts = useAuiState(
    (s) =>
      s.message.role === 'assistant' &&
      (s.message.content.length === 0 ||
        (s.message.content.length === 1 &&
          s.message.content[0]?.type === 'text' &&
          (s.message.content[0] as { type: 'text'; text: string }).text === ''))
  )

  if (!isRunning || hasError || !hasNoParts) return null

  return (
    <Marker className="py-1" role="status">
      <MarkerIcon>
        <LoaderCircleIcon className="animate-spin" />
      </MarkerIcon>
      <span className="animate-pulse text-xs font-medium text-muted-foreground motion-reduce:animate-none">
        Thinking…
      </span>
    </Marker>
  )
}

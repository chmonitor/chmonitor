'use client'

import { CheckIcon, CopyIcon, RefreshCwIcon } from 'lucide-react'

import { ActionBarPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'
import { copyToClipboard } from '@/lib/utils/clipboard'

const COPIED_DURATION_MS = 3000

/**
 * Copy button with an insecure-context fallback. ActionBarPrimitive.Copy calls
 * navigator.clipboard.writeText via its own helper, which is unavailable
 * outside secure contexts (self-hosted HTTP) — the copy silently no-ops.
 * This routes through copyToClipboard, which falls back to execCommand.
 */
function CopyMessageButton() {
  const aui = useAui()
  const isCopied = useAuiState((s) => s.message.isCopied)
  const isEditing = useAuiState((s) => s.composer.isEditing)
  const composerText = useAuiState((s) => s.composer.text)
  const disabled = useAuiState(
    (s) =>
      !(
        (s.message.role !== 'assistant' ||
          s.message.status?.type !== 'running') &&
        s.message.parts.some(
          (part) => part.type === 'text' && part.text.length > 0
        )
      )
  )
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
      aui.message.setIsCopied(false)
    },
    [aui]
  )

  const handleCopy = async () => {
    const text = isEditing ? composerText : aui.message.getCopyText()
    if (!text || !(await copyToClipboard(text))) return
    aui.message.setIsCopied(true)
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      aui.message.setIsCopied(false)
    }, COPIED_DURATION_MS)
  }

  return (
    <TooltipIconButton tooltip="Copy" disabled={disabled} onClick={handleCopy}>
      {isCopied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </TooltipIconButton>
  )
}

export function AssistantActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="text-muted-foreground flex items-center gap-1"
    >
      <CopyMessageButton />
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  )
}

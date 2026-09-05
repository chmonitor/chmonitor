'use client'

import { ArrowRightIcon, ExternalLinkIcon, InfoIcon } from 'lucide-react'

import { LabeledRow } from './labeled-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CONVERSATION_BACKEND_LABELS,
  useConversationBackend,
} from '@/lib/hooks/use-conversation-backend'

/**
 * Read-only row showing where conversation history is persisted. The backend
 * is fixed at deploy time via environment variables, so nothing here is
 * editable — an info tooltip explains that instead of a standing paragraph.
 * For AgentState, a link to the service plus the AI-enrichment status.
 */
export function ConversationHistoryRow() {
  const { backend, supportsAiEnrichment, isLoading } = useConversationBackend()
  const label = CONVERSATION_BACKEND_LABELS[backend]
  const isAgentState = backend === 'agentstate'

  return (
    <div>
      <LabeledRow tag="History">
        <div className="flex items-center gap-1.5">
          <div className="bg-background border-input flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2.5">
            <span className="min-w-0 flex-1 truncate text-[12px]">
              {isLoading ? 'Detecting…' : label}
            </span>
            {isAgentState && (
              <Badge
                variant={supportsAiEnrichment ? 'default' : 'secondary'}
                className="h-4 shrink-0 px-1.5 text-[9px]"
              >
                {supportsAiEnrichment ? 'Enrichment on' : 'Enrichment off'}
              </Badge>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="About conversation history"
                />
              }
            >
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-56 text-[11px]">
              Fixed at deploy time via environment variables — not editable
              here.
            </TooltipContent>
          </Tooltip>
        </div>
      </LabeledRow>

      {isAgentState && (
        <a
          href="https://agentstate.app"
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground hover:bg-muted/40 mt-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] transition-colors"
        >
          <ExternalLinkIcon className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Manage history on AgentState
          </span>
          <ArrowRightIcon className="size-2.5 shrink-0" />
        </a>
      )}
    </div>
  )
}

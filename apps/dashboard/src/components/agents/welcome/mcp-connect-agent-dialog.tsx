'use client'

/**
 * McpConnectAgentDialog
 *
 * Shows how to point an external agent / IDE at THIS cluster's MCP endpoint:
 * the endpoint URL, per-client setup guides, and example prompts. Opened from
 * the "Connect your own agent" entry in the agent settings sidebar (previously
 * a link that navigated away to the full /mcp page).
 *
 * Reuses the same building blocks as the standalone /mcp page — McpEndpointUrl,
 * McpSetupGuides, McpExamplePrompts — so the two surfaces stay in sync. Layout
 * mirrors mcp-tools-resources-dialog.tsx: p-0 content, muted header, plain
 * ScrollArea body (the reused Cards sit on a neutral surface, not card-on-card).
 */

import { ArrowRightIcon, PlugZapIcon } from 'lucide-react'

import { McpEndpointUrl } from '@/components/mcp/mcp-endpoint-url'
import { McpExamplePrompts } from '@/components/mcp/mcp-example-prompts'
import { McpSetupGuides } from '@/components/mcp/mcp-setup-guides'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useHostId } from '@/lib/swr/use-host'

interface McpConnectAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function McpConnectAgentDialog({
  open,
  onOpenChange,
}: McpConnectAgentDialogProps) {
  // Hook at the deepest consumer: the dialog owns the host link itself rather
  // than having the sidebar prop-drill it in.
  const hostId = useHostId()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        {/* Header — mirrors mcp-tools-resources-dialog muted header */}
        <DialogHeader className="border-b bg-muted/30 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <div className="bg-background border-border inline-flex size-10 shrink-0 items-center justify-center rounded-xl border">
              <PlugZapIcon
                className="text-foreground size-4"
                strokeWidth={1.6}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="text-base">
                Connect your own agent
              </DialogTitle>
              <DialogDescription className="text-left text-[12.5px] leading-snug">
                Use this cluster&apos;s MCP endpoint in your IDE or tooling.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <ScrollArea className="max-h-[80dvh]">
          <div className="space-y-5 p-5">
            {/* Endpoint URL */}
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">
                Endpoint URL
              </p>
              <McpEndpointUrl />
            </div>

            {/* Per-client setup guides */}
            <McpSetupGuides />

            {/* Copy-to-clipboard example prompts */}
            <McpExamplePrompts />

            {/* Escape hatch to the full page for tool docs + live playground */}
            <a
              href={`/mcp?host=${hostId}`}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-[11.5px] transition-colors"
            >
              <span className="min-w-0 flex-1">
                Open the full MCP page for tool docs and a live playground.
              </span>
              <ArrowRightIcon className="size-3 shrink-0" />
            </a>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

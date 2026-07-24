'use client'

/**
 * McpToolsResourcesDialog
 *
 * Shows the tools and resources exposed by a single MCP server.
 * Opens when the user clicks on an MCP server row in AgentMcpPanel.
 *
 * Data: fetched once via useMcpServerInfo() (SWR, 5-min cache).
 * Layout: mirrors skill-detail-dialog.tsx — muted-bg header, ScrollArea body.
 */

import { WrenchIcon } from 'lucide-react'

import type { McpServer } from './mcp-types'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useMcpServerInfo } from '@/lib/swr/use-mcp-server-info'

// ---------------------------------------------------------------------------
// Category badge colours
// ---------------------------------------------------------------------------

const CATEGORY_STYLES: Record<string, string> = {
  query: 'bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]',
  schema: 'bg-[var(--chart-1)]/10 text-[var(--chart-1)]',
  system: 'bg-[var(--chart-yellow)]/10 text-[var(--chart-yellow)]',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface McpToolsResourcesDialogProps {
  server: McpServer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpToolsResourcesDialog({
  server,
  open,
  onOpenChange,
}: McpToolsResourcesDialogProps) {
  const { data, isLoading, error, retry } = useMcpServerInfo()

  if (!server) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        {/* Header — mirrors skill-detail-dialog muted header */}
        <DialogHeader className="border-b bg-muted/30 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <div className="bg-background border-border inline-flex size-10 shrink-0 items-center justify-center rounded-xl border">
              <WrenchIcon
                className="text-foreground size-4"
                strokeWidth={1.6}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="truncate font-mono">{server.name}</span>
                {server.version && (
                  <Badge
                    variant="outline"
                    className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
                  >
                    {server.version}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-left text-[12.5px] leading-snug">
                {server.endpoint}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <ScrollArea className="max-h-[70dvh]">
          <div className="space-y-5 p-5">
            {/* Custom server: render probeTools list directly */}
            {server.probeTools !== undefined ? (
              <div>
                <div className="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
                  Tools ({server.probeTools.length})
                </div>
                {server.probeTools.length === 0 ? (
                  <p className="text-muted-foreground text-[12px]">
                    No tools exposed.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {server.probeTools.map((toolName) => (
                      <div
                        key={toolName}
                        className="border-border bg-card rounded-md border px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                          {toolName}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Built-in server: use live info from /api/v1/mcp/info */
              <>
                {isLoading && (
                  <p className="text-muted-foreground text-[12.5px]">
                    Loading tools…
                  </p>
                )}

                {error && !isLoading && (
                  <div className="space-y-2">
                    <p className="text-destructive text-[12.5px]">
                      Failed to load server info.
                    </p>
                    <button
                      type="button"
                      onClick={retry}
                      className="border-border bg-background hover:bg-muted h-7 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {data && (
                  <>
                    {/* Tools section */}
                    <div>
                      <div className="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
                        Tools ({data.tools.length})
                      </div>
                      {data.tools.length === 0 ? (
                        <p className="text-muted-foreground text-[12px]">
                          No tools exposed.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {data.tools.map((tool) => (
                            <div
                              key={tool.name}
                              className="border-border bg-card rounded-md border px-3 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                                  {tool.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`h-4 shrink-0 px-1.5 text-[10px] font-normal ${CATEGORY_STYLES[tool.category] ?? ''}`}
                                >
                                  {tool.category}
                                </Badge>
                              </div>
                              {tool.description && (
                                <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                                  {tool.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Resources section */}
                    <div>
                      <div className="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
                        Resources ({data.resources.length})
                      </div>
                      {data.resources.length === 0 ? (
                        <p className="text-muted-foreground text-[12px]">
                          No resources exposed.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {data.resources.map((resource) => (
                            <div
                              key={resource.uri}
                              className="border-border bg-card rounded-md border px-3 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                                  {resource.name}
                                </span>
                                <span className="text-muted-foreground shrink-0 truncate font-mono text-[10px]">
                                  {resource.uri}
                                </span>
                              </div>
                              {resource.description && (
                                <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                                  {resource.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

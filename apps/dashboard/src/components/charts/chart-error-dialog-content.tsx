import { AlertCircle, BotMessageSquare, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type CardError, getTableMissingInfo } from '@/lib/card-error-utils'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

interface ChartErrorDialogContentProps {
  error: CardError
  title: string
  description: string
  sql?: string
  enableAI?: boolean
  errorMarkdown: string
}

export default function ChartErrorDialogContent({
  error,
  title,
  description,
  sql,
  enableAI = true,
  errorMarkdown,
}: ChartErrorDialogContentProps) {
  const tableMissingInfo = getTableMissingInfo(error)
  const hasTableGuidance = tableMissingInfo?.guidance

  const handleCopyError = async () => {
    try {
      await navigator.clipboard.writeText(errorMarkdown)
      toast.success('Error details copied to clipboard')
    } catch (err) {
      toast.error('Failed to copy error', { description: describeError(err) })
    }
  }

  const handleAskAI = async () => {
    const prompt = `Please analyze this ClickHouse monitoring error and provide a fix:\n\n${errorMarkdown}`
    try {
      await navigator.clipboard.writeText(prompt)
      toast.info('Prompt copied! Paste into your AI agent (Claude, etc.)')
    } catch (err) {
      toast.error('Failed to copy prompt', { description: describeError(err) })
    }
  }

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 rounded-xl border border-border/80 shadow-2xl backdrop-blur-xl">
      <DialogHeader className="shrink-0 pb-2">
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-destructive dark:text-red-400">
          <AlertCircle className="size-5 shrink-0" />
          {title}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground/90 mt-1">
          {description}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="flex-1 min-h-0 pr-2">
        <div className="space-y-5 pb-4">
          {/* Failed ClickHouse SQL Query */}
          {sql && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Failed ClickHouse Query
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2.5 hover:bg-muted/80 rounded-md gap-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(sql)
                      toast.success('SQL query copied to clipboard')
                    } catch (err) {
                      toast.error('Failed to copy SQL', {
                        description: describeError(err),
                      })
                    }
                  }}
                >
                  <Copy className="size-3" />
                  Copy SQL
                </Button>
              </div>
              <pre className="p-3.5 bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-100 overflow-x-auto whitespace-pre leading-relaxed select-all">
                {sql}
              </pre>
            </div>
          )}

          {/* Error message / Traceback */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Diagnostics & Traceback
            </h4>
            <pre className="p-3.5 bg-muted/40 dark:bg-muted/10 border border-border/60 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-foreground/90">
              {error.message}
              {(() => {
                const details = (
                  error as {
                    details?: {
                      originalError?: Error
                      httpStatusCode?: number
                      host?: string
                    }
                  }
                ).details

                if (!details) return null

                const parts: string[] = []

                if (details.httpStatusCode) {
                  parts.push(`HTTP Status Code: ${details.httpStatusCode}`)
                }

                if (details.originalError instanceof Error) {
                  if (details.originalError.message !== error.message) {
                    parts.push(`Caused by: ${details.originalError.message}`)
                  }
                  if (details.originalError.stack) {
                    parts.push(`Stack Trace:\n${details.originalError.stack}`)
                  }
                }

                return parts.length > 0 ? (
                  <span className="text-muted-foreground/80 mt-3.5 pt-3.5 border-t border-border/40 block">
                    {parts.join('\n\n')}
                  </span>
                ) : null
              })()}
            </pre>
          </div>

          {/* Table guidance */}
          {hasTableGuidance && (
            <div className="p-4 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Table Configuration Guidance
              </h4>
              <div className="text-xs space-y-2.5">
                <p className="text-muted-foreground/95 leading-relaxed">
                  {tableMissingInfo.guidance?.description ||
                    'Enable this system log in your ClickHouse config'}
                </p>
                {tableMissingInfo.guidance?.docsUrl && (
                  <a
                    href={tableMissingInfo.guidance.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline font-medium"
                  >
                    <ExternalLink className="size-3" />
                    View ClickHouse docs
                  </a>
                )}
                {tableMissingInfo.guidance?.enableInstructions && (
                  <div className="p-3 bg-muted/40 dark:bg-zinc-900 rounded-md border border-border/50">
                    <p className="font-semibold mb-1">How to enable:</p>
                    <div className="text-[11px] text-foreground/90 leading-relaxed [&>p]:my-0 [&>p+p]:mt-2">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code: ({ className, children, ...props }) => {
                            const isInline = !className?.startsWith('language-')
                            if (isInline) {
                              return (
                                <code
                                  className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
                                  {...props}
                                >
                                  {children}
                                </code>
                              )
                            }
                            return (
                              <code
                                className={cn('font-mono', className)}
                                {...props}
                              >
                                {children}
                              </code>
                            )
                          },
                          pre: ({ children }) => (
                            <pre className="my-2 overflow-x-auto rounded border border-border/50 bg-background p-2 text-[0.9em] leading-snug">
                              {children}
                            </pre>
                          ),
                        }}
                      >
                        {tableMissingInfo.guidance.enableInstructions}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* AI Diagnostics actions footer */}
      {enableAI && (
        <div className="shrink-0 flex flex-wrap gap-2 pt-4 border-t border-border/60 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyError}
            className="text-xs h-8 gap-1.5"
          >
            <Copy className="size-3.5" />
            Copy Diagnostics MD
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleAskAI}
            className="text-xs h-8 gap-1.5"
          >
            <BotMessageSquare className="size-3.5" />
            Ask AI to fix
          </Button>
        </div>
      )}
    </DialogContent>
  )
}

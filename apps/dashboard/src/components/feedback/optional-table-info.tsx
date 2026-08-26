import { ExternalLink, Info } from 'lucide-react'

import type { TableGuidance } from '@/lib/table-guidance'

import { lazy, Suspense } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface OptionalTableInfoProps {
  /** The table name (e.g., "system.text_log") */
  tableName: string
  /** Guidance for enabling the table */
  guidance: TableGuidance
  /** Optional custom title */
  title?: string
  /** Custom className */
  className?: string
}

const LazyGuidanceMarkdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] =
    await Promise.all([import('react-markdown'), import('remark-gfm')])

  function GuidanceMarkdown({ content }: { content: string }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const isInline = !className?.startsWith('language-')
            if (isInline) {
              return (
                <code
                  className="rounded bg-blue-100/60 px-1 py-0.5 font-mono text-[0.85em] text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className={cn('font-mono', className)} {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mt-2 mb-2 overflow-x-auto rounded border border-blue-300/60 bg-slate-900 p-3 text-xs text-slate-50 dark:border-blue-800/60 dark:bg-slate-950 dark:text-slate-100">
              {children}
            </pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    )
  }

  return { default: GuidanceMarkdown }
})

/**
 * OptionalTableInfo Component
 *
 * Displays helpful information when an optional ClickHouse system table is missing.
 * Shows configuration instructions and links to official documentation.
 */
export function OptionalTableInfo({
  tableName,
  guidance,
  title,
  className,
}: OptionalTableInfoProps) {
  return (
    <Card
      className={cn(
        'rounded-md border-blue-200/50 bg-blue-50/30 dark:border-blue-900/30 dark:bg-blue-950/20 shadow-none py-2',
        className
      )}
      role="status"
      aria-label={`Information about ${tableName}`}
    >
      <CardContent className="p-6">
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <Info className="size-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground mb-2">
              {title ||
                (tableName === 'system.text_log'
                  ? 'Text Log Not Configured'
                  : tableName === 'system.crash_log'
                    ? 'Crash Log Not Available'
                    : 'Table Not Available')}
            </h3>

            <div className="text-sm text-muted-foreground space-y-3">
              <div className="leading-relaxed [&>p]:my-0 [&>p+p]:mt-2">
                <Suspense
                  fallback={
                    <div className="whitespace-pre-wrap">
                      {guidance.enableInstructions}
                    </div>
                  }
                >
                  <LazyGuidanceMarkdown content={guidance.enableInstructions} />
                </Suspense>
              </div>

              {guidance.docsUrl && (
                <div className="pt-2 border-t border-blue-200/50 dark:border-blue-900/50">
                  <a
                    href={guidance.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline font-medium"
                  >
                    <ExternalLink className="size-3.5" />
                    View ClickHouse documentation
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

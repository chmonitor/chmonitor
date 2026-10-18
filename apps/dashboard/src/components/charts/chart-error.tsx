import { Info, RefreshCw } from 'lucide-react'

import { lazy, Suspense, useState } from 'react'
import { chartCard } from '@/components/charts/chart-card-styles'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type CardError,
  detectCardErrorVariant,
  getCardErrorClassName,
  getCardErrorDescription,
  getCardErrorTitle,
  shouldShowRetryButton,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'
import { cn } from '@/lib/utils'

// Heavy deps (react-markdown + remark-gfm) are deferred into this chunk so
// they are excluded from the initial bundle and only downloaded when a user
// opens the Diagnostics dialog.
const ChartErrorDialogContent = lazy(
  () => import('./chart-error-dialog-content')
)

interface ChartErrorProps {
  error: CardError
  title?: string
  className?: string
  onRetry?: () => void
  /** Use compact layout for smaller charts */
  compact?: boolean
  /** Enable AI assistance features */
  enableAI?: boolean
  /** The failed ClickHouse SQL query (if available) */
  sql?: string
}

export const ChartError = function ChartError({
  error,
  title: customTitle,
  className,
  onRetry,
  compact = false,
  enableAI = true,
  sql,
}: ChartErrorProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const variant = detectCardErrorVariant(error)
  const title = getCardErrorTitle(variant, customTitle)
  const description = getCardErrorDescription(error, variant, compact)
  const errorClassName = getCardErrorClassName(variant)
  const showRetry = onRetry && shouldShowRetryButton(error)

  // Generate markdown for AI prompts — passed to the lazy dialog content so it
  // can be computed here without pulling in react-markdown.
  const errorMarkdown = `# ${customTitle || 'ClickHouse Error'}

**Error:** ${error?.message || 'Unknown'}

${
  sql
    ? `**Failed SQL Query:**
\`\`\`sql
${sql}
\`\`\`
`
    : ''
}${
  error instanceof Error && error.stack
    ? `**Stack:**
\`\`\`
${error.stack}
\`\`\`
`
    : ''
}`

  return (
    <Card
      className={cn(
        chartCard.base,
        chartCard.variants.error,
        errorClassName,
        'transition-all duration-300 hover:border-destructive/40',
        className
      )}
      role="alert"
      aria-label={title ? `${title} error` : 'Error loading chart'}
    >
      <CardContent className={chartCard.contentError}>
        <EmptyState
          variant={toEmptyStateVariant(variant)}
          title={title}
          description={description}
          compact={compact}
          action={
            showRetry
              ? {
                  label: 'Retry',
                  onClick: onRetry,
                  icon: (
                    <RefreshCw className="mr-1.5 size-3.5 animate-spin-slow" />
                  ),
                }
              : undefined
          }
        />

        {!compact && (
          <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-muted/50">
            <span className="text-xs text-muted-foreground truncate flex-1 font-mono max-w-[80%]">
              {error.message}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetailsOpen(true)}
              className="h-7 px-2.5 text-xs rounded-full hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all"
            >
              <Info className="size-3 mr-1 shrink-0" />
              Diagnostics
            </Button>
          </div>
        )}

        {/* Error details dialog — content is lazy-loaded to keep react-markdown
            and remark-gfm out of the initial bundle. The chunk only downloads
            when the user clicks "Diagnostics" for the first time. */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <Suspense
            fallback={
              <div className="max-w-2xl p-6 space-y-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            }
          >
            {detailsOpen && (
              <ChartErrorDialogContent
                error={error}
                title={title}
                description={description}
                sql={sql}
                enableAI={enableAI}
                errorMarkdown={errorMarkdown}
              />
            )}
          </Suspense>
        </Dialog>
      </CardContent>
    </Card>
  )
}

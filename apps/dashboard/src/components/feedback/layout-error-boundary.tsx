import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'

import { ErrorLogger } from '@chm/logger'
import { Button } from '@/components/ui/button'
import { captureException } from '@/lib/analytics/analytics'
import { reportClientError } from '@/lib/observability/sentry'

/**
 * Error boundary fallback for layout-level errors
 * Provides a clean recovery UI when a page component crashes
 */
function LayoutErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <div className="bg-destructive/10 flex size-16 items-center justify-center rounded-full">
          <AlertTriangleIcon className="text-destructive size-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground text-sm">
            {(error instanceof Error ? error.message : String(error)) ||
              'An unexpected error occurred while loading this page.'}
          </p>
        </div>
        <Button onClick={resetErrorBoundary} className="gap-2">
          <RefreshCwIcon className="size-4" />
          Try Again
        </Button>
      </div>
    </div>
  )
}

/**
 * Layout-level error boundary wrapper
 * Catches errors in page components and provides recovery UI
 */
export function LayoutErrorBoundary({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ErrorBoundary
      fallbackRender={LayoutErrorFallback}
      onError={(error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        ErrorLogger.logError(err, {
          component: 'LayoutErrorBoundary',
          action: 'caught',
        })
        // Report to Sentry (no-op when disabled / on the server).
        reportClientError(err, { boundary: 'LayoutErrorBoundary' })
        // Report the crash to PostHog too (no-op when analytics is disabled).
        captureException(err, { boundary: 'LayoutErrorBoundary' })
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

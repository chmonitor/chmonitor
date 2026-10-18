import { RefreshCwIcon } from 'lucide-react'

import type React from 'react'
import type { ErrorIconType } from '../error-alert-icons'
import type { ErrorAlertVariant } from '../error-alert-variants'

import {
  ErrorAlertAccordion,
  ErrorAlertDigest,
  ErrorAlertDocs,
} from '../error-alert-accordion'
import { getErrorIcon } from '../error-alert-icons'
import { getVariantStyles } from '../error-alert-variants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getEnvironment, shouldShowDetailedErrors } from '@/lib/env-utils'
import { cn } from '@/lib/utils'

export interface FullErrorAlertProps {
  title: string
  message: string | React.ReactNode | React.ReactNode[]
  docs?: string | React.ReactNode | React.ReactNode[]
  query?: string
  reset?: () => void
  className?: string
  variant: ErrorAlertVariant
  errorType?: ErrorIconType
  digest?: string
  stack?: string
  countdown: number
}

const renderContent = (
  content: string | React.ReactNode | React.ReactNode[]
) => (
  <div className="text-muted-foreground text-sm leading-relaxed">
    {typeof content === 'string' ? <div>{content}</div> : content}
  </div>
)

export function FullErrorAlert({
  title,
  message,
  docs,
  query,
  reset,
  className,
  variant,
  errorType,
  digest,
  stack,
  countdown,
}: FullErrorAlertProps) {
  const showDetails = shouldShowDetailedErrors()
  const environment = getEnvironment()

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        getVariantStyles(variant),
        className
      )}
      data-testid="error-message-full"
      role="alert"
      aria-live="polite"
      aria-label={`Error: ${title}`}
    >
      <div className="flex items-start gap-3">
        {getErrorIcon(errorType)}
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-foreground font-medium">{title}</div>
            {showDetails && (
              <Badge variant="outline" className="text-xs">
                {environment}
              </Badge>
            )}
          </div>
          {message && renderContent(message)}

          {showDetails && stack && (
            <ErrorAlertAccordion title="Stack Trace" content={stack} />
          )}

          {Boolean(query) && (
            <ErrorAlertAccordion title="View Query Details" content={query} />
          )}

          {Boolean(docs) && <ErrorAlertDocs docs={docs} />}

          {digest && <ErrorAlertDigest digest={digest} />}

          {reset && (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => reset()}
                className="flex items-center gap-2"
              >
                <RefreshCwIcon className="size-4" />
                Try again {countdown >= 0 && `(${countdown}s)`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

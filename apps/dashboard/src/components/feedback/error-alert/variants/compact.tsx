import type React from 'react'
import type { ErrorAlertVariant } from '../error-alert-variants'

import { getVariantStyles } from '../error-alert-variants'
import { cn } from '@/lib/utils'

export interface CompactErrorAlertProps {
  title: string
  message: string | React.ReactNode | React.ReactNode[]
  className?: string
  variant: ErrorAlertVariant
}

export function CompactErrorAlert({
  title,
  message,
  className,
  variant,
}: CompactErrorAlertProps) {
  const compactMessage =
    typeof message === 'string' ? message.split('\n')[0] : message

  return (
    <div
      className={cn(
        'rounded-lg border p-2',
        getVariantStyles(variant),
        className
      )}
      data-testid="error-message-compact"
      role="alert"
      aria-live="polite"
      aria-label={`Error: ${title}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <div className="text-foreground text-sm">{title}</div>
          {message && (
            <div className="text-muted-foreground text-xs">
              {typeof compactMessage === 'string'
                ? compactMessage.substring(0, 50) +
                  (compactMessage.length > 50 ? '...' : '')
                : compactMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

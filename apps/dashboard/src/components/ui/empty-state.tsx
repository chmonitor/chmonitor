import { CircleSlash, RefreshCw } from 'lucide-react'

import { Button } from './button'
import { memo } from 'react'
import { EmptyStateIllustration } from '@/components/illustrations/empty-state-illustration'
import { cn } from '@/lib/utils'

export type EmptyStateVariant =
  | 'no-data'
  | 'no-results'
  | 'error'
  | 'loading'
  | 'offline'
  | 'table-missing'
  | 'timeout'
  | 'filtered-empty'

interface EmptyStateProps {
  variant?: EmptyStateVariant
  title?: string
  description?: string | React.ReactNode
  icon?: React.ReactNode
  action?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  /** Inline refresh callback - shows small refresh icon next to title */
  onRefresh?: () => void
  className?: string
  /** Smaller variant for inline use */
  compact?: boolean
}

// Titles/descriptions per variant. The illustration is supplied by the shared
// `EmptyStateIllustration` (a bespoke ~40×40 SVG per variant) unless the caller
// passes an explicit `icon` override.
const variantConfig: Record<
  EmptyStateVariant,
  { title: string; description: string }
> = {
  'no-data': {
    title: 'No data available',
    description:
      'There is no data to display. This could be due to no activity in the selected time period.',
  },
  'no-results': {
    title: 'No results found',
    description:
      "Try adjusting your search or filter criteria to find what you're looking for.",
  },
  error: {
    title: 'Failed to load data',
    description: 'An error occurred while fetching data. Please try again.',
  },
  loading: {
    title: 'Loading...',
    description: 'Please wait while we fetch your data.',
  },
  offline: {
    title: "You're offline",
    description: 'Check your internet connection and try again.',
  },
  'table-missing': {
    title: 'Table not available',
    description:
      "This feature requires additional ClickHouse configuration or the system table doesn't exist.",
  },
  timeout: {
    title: 'Request timed out',
    description:
      'The query took too long to execute. Try narrowing your search or increasing the timeout.',
  },
  'filtered-empty': {
    title: 'No matching results',
    description:
      'No data matches your current filters. Try removing some filters.',
  },
}

export const EmptyState = memo(function EmptyState({
  variant = 'no-data',
  title,
  description,
  icon,
  action,
  secondaryAction,
  onRefresh,
  className,
  compact = false,
}: EmptyStateProps) {
  const config = variantConfig[variant]

  if (compact) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-4 text-center',
          className
        )}
      >
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
          {icon || <EmptyStateIllustration variant={variant} />}
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground truncate max-w-full">
            {title || config.title}
          </p>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-0.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
        {action && (
          <Button
            variant="ghost"
            size="sm"
            onClick={action.onClick}
            className="mt-2 h-7 text-xs"
          >
            {action.icon}
            {action.label}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-2 text-center',
        'animate-in fade-in-0 slide-in-from-bottom-2 duration-300',
        className
      )}
    >
      {/* Decorative background circles. Note: no `animate-pulse` here — a
          settled empty state must not look like it is still loading (a pulsing
          glow reads as a skeleton to users and to a11y/loading heuristics). */}
      <div className="relative mb-4">
        <div className="absolute inset-0 scale-150 rounded-full bg-muted/20" />
        <div className="absolute inset-0 scale-125 rounded-full bg-muted/40" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 backdrop-blur-sm">
          {icon || <EmptyStateIllustration variant={variant} />}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <h3 className="text-base font-semibold text-foreground">
          {title || config.title}
        </h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
      <div className="mt-1.5 max-w-full sm:max-w-md w-full px-4 text-sm text-muted-foreground leading-relaxed line-clamp-2 overflow-hidden">
        {description || config.description}
      </div>

      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center gap-2">
          {action && (
            <Button
              variant="outline"
              size="sm"
              onClick={action.onClick}
              className="transition-[box-shadow] hover:shadow-sm"
            >
              {action.icon}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
})
/**
 * Inline empty state for use within table cells or small areas
 */
export const InlineEmptyState = memo(function InlineEmptyState({
  message = 'No data',
  className,
}: {
  message?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-muted-foreground',
        className
      )}
    >
      <CircleSlash className="h-3.5 w-3.5" strokeWidth={1.5} />
      <span className="text-sm">{message}</span>
    </div>
  )
})

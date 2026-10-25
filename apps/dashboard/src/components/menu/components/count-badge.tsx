import type { BadgeVariant } from '@/types/badge-variant'

import { useMenuCount } from '../hooks/use-menu-count'
import { memo, useEffect, useRef } from 'react'
import { formatReadableQuantity } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface CountBadgeProps {
  countKey?: string
  countLabel?: string
  countVariant?: BadgeVariant
}

export const CountBadge = memo(function CountBadge({
  countKey,
  countLabel,
  countVariant = 'secondary',
}: CountBadgeProps) {
  const hostId = useHostId()
  const { count, isLoading } = useMenuCount(countKey, hostId)
  const isFirstRenderRef = useRef(true)

  useEffect(() => {
    isFirstRenderRef.current = false
  }, [])

  if (isLoading || count === null || count === 0) {
    return null
  }

  const variantClasses =
    countVariant === 'destructive'
      ? 'bg-destructive/15 text-destructive'
      : 'bg-muted text-muted-foreground'

  return (
    <span
      className={cn(
        'group/count inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5',
        'text-[10px] max-sm:text-xs font-medium tabular-nums',
        'transition-all duration-200 ease-out',
        'group-data-[state=collapsed]/sidebar:hidden',
        variantClasses
      )}
    >
      <span
        key={count}
        className={cn('shrink-0', !isFirstRenderRef.current && 't-digit')}
      >
        {formatReadableQuantity(count, 'short')}
      </span>
      {countLabel && (
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap',
            'transition-all duration-200 ease-out',
            'max-w-0 opacity-0',
            'group-hover/count:max-w-20 group-hover/count:opacity-100'
          )}
        >
          {countLabel}
        </span>
      )}
    </span>
  )
})

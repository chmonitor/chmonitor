import type { BadgeVariant } from '@/types/badge-variant'

import { useMenuCount } from './hooks/use-menu-count'
import { Badge } from '@/components/ui/badge'
import { formatReadableQuantity } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr'

export interface CountBadgeProps {
  /** Key for fetching count from /api/v1/menu-counts/[key] */
  countKey?: string
  className?: string
  variant?: BadgeVariant
}

/**
 * Client-side count badge that fetches count.
 * Uses countKey to fetch from /api/v1/menu-counts/[key] endpoint.
 * No raw SQL is sent from the client - security by design.
 */
export const CountBadge = function CountBadge({
  countKey,
  className,
  variant = 'outline',
}: CountBadgeProps) {
  const hostId = useHostId()
  const { count, isLoading } = useMenuCount(countKey, hostId)

  if (isLoading || !count || count === 0) return null

  return (
    <Badge className={className} variant={variant}>
      {formatReadableQuantity(count, 'short')}
    </Badge>
  )
}

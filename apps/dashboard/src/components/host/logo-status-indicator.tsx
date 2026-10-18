import { useHostStatus } from '@/lib/swr/use-host-status'
import { cn } from '@/lib/utils'

interface LogoStatusIndicatorProps {
  hostId: number
}

const indicatorBaseStyles =
  'absolute -bottom-0.5 -left-1 size-1.5 rounded-full ring-2 ring-sidebar'

export const LogoStatusIndicator = function LogoStatusIndicator({
  hostId,
}: LogoStatusIndicatorProps) {
  const { isOnline, isLoading } = useHostStatus(hostId, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  })

  if (isLoading) return <LogoStatusIndicatorSkeleton />

  return (
    <span
      className={cn(
        indicatorBaseStyles,
        isOnline && 'bg-emerald-500',
        !isOnline && 'bg-red-400'
      )}
      title={isOnline ? 'Online' : 'Offline'}
    />
  )
}

export const LogoStatusIndicatorSkeleton = () => (
  <span className={cn(indicatorBaseStyles, 'bg-gray-400 animate-pulse')} />
)

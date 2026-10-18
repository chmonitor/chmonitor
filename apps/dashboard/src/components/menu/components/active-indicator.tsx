import { cn } from '@/lib/utils'

interface ActiveIndicatorProps {
  position: 'bottom' | 'left'
  active?: boolean
}

/**
 * Visual indicator showing active menu item state
 *
 * Displays as an underline (bottom) or left border (left).
 */
export function ActiveIndicator({
  position,
  active = false,
}: ActiveIndicatorProps) {
  const baseClasses =
    'absolute bg-primary transition-transform duration-200 rounded-full'

  if (position === 'bottom') {
    return (
      <span
        className={cn(
          baseClasses,
          'bottom-0 left-1/2 h-[2px] w-[calc(100%-1.5rem)] -translate-x-1/2',
          active ? 'scale-x-100' : 'scale-x-0'
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        baseClasses,
        'left-0 top-1/2 h-4 w-[2px] -translate-y-1/2',
        active ? 'scale-y-100' : 'scale-y-0'
      )}
    />
  )
}

import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

interface TooltipColorIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  colorVar: string
  size?: 'default' | 'small'
}

export function TooltipColorIndicator({
  colorVar,
  size = 'default',
  className = '',
  style,
  ...props
}: TooltipColorIndicatorProps) {
  const sizeClass = size === 'small' ? 'size-2' : 'size-2.5'

  return (
    <div
      className={cn(
        'shrink-0 rounded-[2px] bg-(--color-bg)',
        sizeClass,
        className
      )}
      style={
        {
          '--color-bg': colorVar,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

import { memo, useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ColoredBadgeOptions {
  className?: string
  /** Fixed classes per value, for badges whose values carry meaning. */
  valueClassNames?: Record<string, string>
}

interface ColoredBadgeFormatProps {
  value: React.ReactNode
  options?: ColoredBadgeOptions
}

export const ColoredBadgeFormat = memo(function ColoredBadgeFormat({
  value,
  options,
}: ColoredBadgeFormatProps): React.ReactNode {
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    isFirstRenderRef.current = false
  }, [])

  const pickedColor = useMemo(() => {
    if (value == null || value === '' || typeof value === 'boolean') return ''

    const fixed = options?.valueClassNames?.[String(value)]
    if (fixed) return fixed

    const colors = [
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
      'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
      'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
    ]

    return colors[
      Math.abs(
        value
          .toString()
          .split('')
          .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)
      ) % colors.length
    ]
  }, [value, options?.valueClassNames])

  if (value == null || value === '' || typeof value === 'boolean') {
    return null
  }

  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        pickedColor,
        options?.className
      )}
    >
      <span
        key={String(value)}
        className={isFirstRenderRef.current ? undefined : 't-text-swap'}
      >
        {value}
      </span>
    </span>
  )
})

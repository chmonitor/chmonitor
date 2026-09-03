import type { ReactNode } from 'react'

import { matchRanges } from '../command-palette-utils'
import { cn } from '@/lib/utils'

/**
 * Wrap query-token hits in `text` with a token-colored mark so ⌘K matches
 * are visible in titles and descriptions.
 */
export function HighlightText({
  text,
  query,
  className,
}: {
  text: string
  query: string
  className?: string
}) {
  const ranges = matchRanges(text, query)
  if (ranges.length === 0) {
    return <span className={className}>{text}</span>
  }

  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push(text.slice(cursor, start))
    }
    parts.push(
      <mark key={start} className="rounded-sm bg-primary/25 text-foreground">
        {text.slice(start, end)}
      </mark>
    )
    cursor = end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return <span className={cn(className)}>{parts}</span>
}

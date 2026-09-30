import { cn } from '@/lib/utils'

/**
 * Shared class strings for the small icon actions in a chart card header
 * (zoom, CSV export, log scale, stale indicator, actions menu).
 *
 * Fine pointers (mouse) keep the hover-reveal: actions fade in when the card
 * (`group`) is hovered or focused. Coarse pointers (touch) have no hover, so
 * the actions rest visible and grow to a 36px hit target.
 */
const BASE = cn(
  'size-6 rounded-full transition-opacity pointer-coarse:size-9',
  'relative before:content-[""] before:absolute before:-inset-4'
)

/** Resting opacity is 40%, or 60% for the stale indicator (`emphasis`). */
export function chartActionClass({
  alwaysVisible = false,
  emphasis = false,
}: {
  alwaysVisible?: boolean
  emphasis?: boolean
} = {}): string {
  if (alwaysVisible) {
    return cn(
      BASE,
      emphasis ? 'opacity-60 hover:opacity-100' : 'opacity-40 hover:opacity-100'
    )
  }
  return cn(
    BASE,
    emphasis
      ? 'opacity-60 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-60 pointer-fine:group-focus-within:opacity-60 hover:!opacity-100'
      : 'opacity-40 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-40 pointer-fine:group-focus-within:opacity-40 hover:!opacity-100'
  )
}

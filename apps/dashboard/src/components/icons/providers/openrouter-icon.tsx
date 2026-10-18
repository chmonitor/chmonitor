/**
 * OpenRouter provider mark.
 *
 * Two overlapping circles (open / route): a simple ring with an arc — the
 * unofficial "OR" glyph reduced to geometry. Reads cleanly at 14–16 px.
 */
interface OpenRouterIconProps {
  className?: string
  size?: number
}

export function OpenRouterIcon({ className, size = 16 }: OpenRouterIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="6" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Right circle, shifted — overlapping "OR" lens */}
      <circle cx="10" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

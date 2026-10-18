/**
 * AnyRouter provider mark.
 *
 * Geometric "A" / router-node motif: a central hub square connected to three
 * corner dots with thin lines — minimal enough to read at 14–16 px.
 */
interface AnyRouterIconProps {
  className?: string
  size?: number
}

export function AnyRouterIcon({ className, size = 16 }: AnyRouterIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" />
      <line
        x1="2"
        y1="2"
        x2="6"
        y2="6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <line
        x1="14"
        y1="2"
        x2="10"
        y2="6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="14"
        x2="8"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle cx="2" cy="2" r="1.5" fill="currentColor" />
      <circle cx="14" cy="2" r="1.5" fill="currentColor" />
      <circle cx="8" cy="14" r="1.5" fill="currentColor" />
    </svg>
  )
}

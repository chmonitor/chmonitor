/**
 * NVIDIA provider mark.
 *
 * Angular "N" — simplified from NVIDIA's wordmark to a geometric monogram
 * that reads at 14–16 px.
 */
interface NvidiaIconProps {
  className?: string
  size?: number
}

export function NvidiaIcon({ className, size = 16 }: NvidiaIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 13V3L8 10V3M13 3V13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

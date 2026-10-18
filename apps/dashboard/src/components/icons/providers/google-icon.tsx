/**
 * Google provider mark.
 *
 * Four-colour "G" reduced to the iconic arc shape in monochrome.
 * Reads clearly at 14–16 px without colour dependency.
 */
interface GoogleIconProps {
  className?: string
  size?: number
}

export function GoogleIcon({ className, size = 16 }: GoogleIconProps) {
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
        d="M13.5 8.1C13.5 7.5 13.45 7 13.37 6.5H8V9.2H11.14C10.98 10.05 10.5 10.76 9.77 11.24V13H11.74C12.84 12 13.5 10.17 13.5 8.1Z"
        fill="currentColor"
        opacity="0.8"
      />
      <path
        d="M8 14C9.62 14 10.98 13.47 11.74 13L9.77 11.24C9.26 11.59 8.69 11.8 8 11.8C6.45 11.8 5.14 10.75 4.66 9.34H2.62V11.16C3.63 13.07 5.67 14 8 14Z"
        fill="currentColor"
        opacity="0.6"
      />
      <path
        d="M4.66 9.34C4.54 8.99 4.47 8.62 4.47 8.24C4.47 7.87 4.54 7.5 4.66 7.14V5.32H2.62C2.22 6.12 2 7.01 2 8.24C2 9.17 2.22 10.06 2.62 10.86L4.66 9.34Z"
        fill="currentColor"
        opacity="0.4"
      />
      <path
        d="M8 4.2C8.82 4.2 9.55 4.48 10.12 5.02L11.7 3.44C10.8 2.61 9.57 2 8 2C5.67 2 3.63 3.17 2.62 5.32L4.66 7.14C5.14 5.73 6.45 4.2 8 4.2Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  )
}

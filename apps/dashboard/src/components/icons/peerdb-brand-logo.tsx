import type { LucideProps } from 'lucide-react'

import { forwardRef } from 'react'

export const PeerDBLogo = forwardRef<SVGSVGElement, LucideProps>(
  ({ className, width = 24, height = 24, ...props }, ref) => {
    return (
      <svg
        ref={ref}
        role="img"
        viewBox="0 0 24 24"
        fill="currentColor"
        width={width}
        height={height}
        className={className}
        {...props}
      >
        <title>PeerDB</title>
        <g transform="translate(0, 5.016) scale(0.291)">
          <path d="M35.67 5.33H7.7C4.27 5.33 1.2 3.21 0 0H64.77C77.51 0 86.51 12.48 82.48 24.57L74.67 48H69.33L77.76 22.91C80.66 14.27 74.24 5.33 65.12 5.33H41V8C41 18.31 49.36 26.67 59.67 26.67H71L64 48H58.67L64 32H59.67C46.41 32 35.67 21.25 35.67 8V5.33Z" />
          <path d="M17.67 26.67H14.7C11.27 26.67 8.2 24.54 7 21.33H19.67L21.33 16H10.92C7.6 16 4.66 13.84 3.67 10.67H28.33L16 48H10.67L17.67 26.67Z" />
          <path d="M32 48H26.67L29.69 38.92C31.07 34.79 34.94 32 39.29 32C46.2 32 51.08 38.77 48.89 45.32L48 48H42.33L43.73 43.95C44.84 40.71 42.43 37.33 39 37.33C36.82 37.33 34.89 38.75 34.24 40.84L32 48Z" />
          <path d="M70.67 16C70.67 18.21 68.88 20 66.67 20C64.46 20 62.67 18.21 62.67 16C62.67 13.79 64.46 12 66.67 12C68.88 12 70.67 13.79 70.67 16Z" />
        </g>
      </svg>
    )
  }
)

PeerDBLogo.displayName = 'PeerDBLogo'

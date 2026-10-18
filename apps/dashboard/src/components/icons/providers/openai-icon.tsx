/**
 * OpenAI provider mark.
 *
 * Simplified six-point star / atom ring from OpenAI's logomark geometry,
 * reduced to a clean 16 px version: six inward petals around a center circle.
 */
interface OpenAIIconProps {
  className?: string
  size?: number
}

export function OpenAIIcon({ className, size = 16 }: OpenAIIconProps) {
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
        d="M8 1.5 C9.4 1.5 10.5 2.3 11 3.6 C12.3 3.1 13.7 3.6 14.4 4.8 C15.1 6 14.8 7.4 13.8 8.2 C14.5 9.4 14.2 10.9 13.1 11.7 C12 12.5 10.5 12.4 9.6 11.6 C8.9 12.7 7.5 13.2 6.2 12.7 C4.9 12.2 4.1 10.9 4.3 9.5 C3 9.3 2 8.3 2 7 C2 5.7 3 4.7 4.3 4.5 C4.1 3.1 4.9 1.8 6.2 1.3 C6.7 1.1 7.4 1.3 8 1.5 Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="7" r="1.5" fill="currentColor" />
    </svg>
  )
}

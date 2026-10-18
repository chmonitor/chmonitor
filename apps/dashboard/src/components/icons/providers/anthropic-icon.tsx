/**
 * Anthropic provider mark.
 *
 * Stylised "A" triangle — the clearest reduction of Anthropic's letterform.
 * Clean at 14–16 px.
 */
interface AnthropicIconProps {
  className?: string
  size?: number
}

export function AnthropicIcon({ className, size = 16 }: AnthropicIconProps) {
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
        d="M8 2L14 14H2L8 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <line
        x1="5.5"
        y1="10"
        x2="10.5"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface IconProps {
  className?: string
  size?: number
}

export function MistralIcon({ className, size = 16 }: IconProps) {
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
        d="M2 2h3v3H2V2ZM6 2h3v3H6V2ZM10 2h3v3h-3V2ZM2 6h3v3H2V6ZM6 6h3v3H6V6ZM10 6h3v3h-3V6ZM2 10h3v3H2v-3ZM6 10h3v3H6v-3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PerplexityIcon({ className, size = 16 }: IconProps) {
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
        d="M8 2v12M8 2l3 3-3 3M8 2L5 5l3 3M8 14l3-3-3-3M8 14l-3-3 3-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </svg>
  )
}

export function DeepInfraIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="5.5" r="1.5" fill="currentColor" />
      <circle cx="5.5" cy="10.5" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="10.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function FireworksAIIcon({ className, size = 16 }: IconProps) {
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
        d="M8 2l1.5 3L13 6l-3.5 1L8 10l-1.5-3L3 6l3.5-1L8 2Z"
        fill="currentColor"
        opacity="0.8"
      />
      <path
        d="M8 8l1 2 2.5.5L9 11l-1 2-1-2-2.5-.5L7 10l1-2Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  )
}

export function ScaleWayIcon({ className, size = 16 }: IconProps) {
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
        d="M3 8l5-5 5 5-5 5-5-5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function NebiusIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 5l2 3-2 3M11 5l-2 3 2 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function VultrIcon({ className, size = 16 }: IconProps) {
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
        d="M8 2l6 6-6 6M8 2L2 8l6 6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function UpstageIcon({ className, size = 16 }: IconProps) {
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
        d="M2 8h12M8 2v12M3.5 3.5l3 3M12.5 3.5l-3 3M3.5 12.5l3-3M12.5 12.5l-3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function AlibabaIcon({ className, size = 16 }: IconProps) {
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
        d="M2 4h3v3H2V4ZM11 4h3v3h-3V4ZM2 9h3v3H2V9ZM11 9h3v3h-3V9Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <line
        x1="6"
        y1="8"
        x2="10"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function MoonshotIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 8a3 3 0 0 1 6 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ZhipuAIIcon({ className, size = 16 }: IconProps) {
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
        d="M4 4l4 8 4-8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="2"
        y1="12"
        x2="14"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ZAIIcon({ className, size = 16 }: IconProps) {
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
        d="M3 3l5 5-5 5M13 3L8 8l5 5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FastRouterIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 8l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WandbIcon({ className, size = 16 }: IconProps) {
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
        d="M4 3v10l3-3V6l-3-3ZM9 6l3-3v10l-3-3V6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function OpenCodeIcon({ className, size = 16 }: IconProps) {
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
        d="M5 4L2 8l3 4M11 4l3 4-3 4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="9.5"
        y1="3"
        x2="6.5"
        y2="13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function VertexAIIcon({ className, size = 16 }: IconProps) {
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
        d="M8 2l6 10H2L8 2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="9" r="1.2" fill="currentColor" />
    </svg>
  )
}

export function LMStudioIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5 9l2-3 2 3 2-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BasetenIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function VeniceIcon({ className, size = 16 }: IconProps) {
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
        d="M2 4l6 10 6-10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 6l3 5 3-5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DeepSeekIcon({ className, size = 16 }: IconProps) {
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
        d="M4 3h8v2H4V3ZM4 7h8v2H4V7ZM4 11h5v2H4v-2Z"
        fill="currentColor"
        opacity="0.8"
      />
      <circle cx="11" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function GroqIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="6" cy="8" r="1.5" fill="currentColor" />
      <circle cx="10" cy="8" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function TogetherAIIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <line
        x1="8"
        y1="7.5"
        x2="8"
        y2="8.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

export function VercelIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2l7 12H1L8 2Z" fill="currentColor" />
    </svg>
  )
}

export function XAIIcon({ className, size = 16 }: IconProps) {
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
        d="M4 3l4 5-4 5M12 3L8 8l4 5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function HuggingFaceIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 7c.5-.7 1.5-1 3-1s2.5.3 3 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="6" cy="9" r=".8" fill="currentColor" />
      <circle cx="10" cy="9" r=".8" fill="currentColor" />
    </svg>
  )
}

export function MetaIcon({ className, size = 16 }: IconProps) {
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
        d="M8 3c-2 0-3.5 1-4 2.5C3.5 7 4.5 9 6 10.5L8 12l2-1.5c1.5-1.5 2.5-3.5 2-5C12.5 4 11 3 8 3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AzureIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M7 2l5 3-3 9H4l4-6H5l3-6h-1Z" fill="currentColor" />
    </svg>
  )
}

export function CerebrasIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" opacity="0.8" />
    </svg>
  )
}

export function ReplicateIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2"
        y="2"
        width="5"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="9"
        y="2"
        width="5"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="2"
        y="9"
        width="5"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.5"
      />
      <rect
        x="9"
        y="9"
        width="5"
        height="5"
        rx="1"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  )
}

export function GitHubCopilotIcon({ className, size = 16 }: IconProps) {
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
        d="M4 3l4-2 4 2v4a5 5 0 0 1-4 5 5 5 0 0 1-4-5V3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="7" r=".8" fill="currentColor" />
      <circle cx="9.5" cy="7" r=".8" fill="currentColor" />
    </svg>
  )
}

export function CloudflareIcon({ className, size = 16 }: IconProps) {
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
        d="M7 2c-1.5 0-3 1-3.5 2.5C2 5 1 6.7 1 8.5 1 10.4 2.6 12 4.5 12h7c1.9 0 3.5-1.6 3.5-3.5a3.5 3.5 0 0 0-3-3.5C11.5 3 9.5 2 7 2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function V0Icon({ className, size = 16 }: IconProps) {
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
        d="M4 4l4 4-4 4M12 4L8 8l4 4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AmazonBedrockIcon({ className, size = 16 }: IconProps) {
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
        d="M8 2l6 6-6 6M8 2L2 8l6 6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  )
}

import { monogramColor, monogramLetter } from '@/lib/provider-logos'

export function MonogramProviderIcon({
  provider,
  className,
  size = 16,
}: {
  provider: string
  className?: string
  size?: number
}) {
  const color = monogramColor(provider)
  const letter = monogramLetter(provider)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="3"
        fill={color}
        fillOpacity="0.15"
        stroke={color}
        strokeWidth="1.2"
      />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill={color}
        fontSize="9"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  )
}

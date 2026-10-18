'use client'

import { FileText, GraduationCap, type LucideIcon, Zap } from 'lucide-react'

import type { InsightPromptStyle } from '@/lib/insights/prompts'
import type { InsightTemplate } from '@/lib/insights/templates'

export const STYLE_ICONS: Record<InsightPromptStyle, LucideIcon> = {
  concise: Zap,
  detailed: FileText,
  beginner: GraduationCap,
}

// Inline SVG glyph used in the "Enhance with AI" row
export function EnhanceGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <line
        x1="8"
        y1="1"
        x2="8"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="12"
        x2="8"
        y2="15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="1"
        y1="8"
        x2="4"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="8"
        x2="15"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="3"
        x2="5.5"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="10.5"
        y1="10.5"
        x2="13"
        y2="13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="13"
        y1="3"
        x2="10.5"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="5.5"
        y1="10.5"
        x2="3"
        y2="13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="1.75" fill="currentColor" />
    </svg>
  )
}

export const TEMPLATE_SVG: Record<
  InsightTemplate['icon'],
  React.ComponentType<{ className?: string }>
> = {
  Zap: ({ className }) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M8.5 1.5L3 8H7L5.5 12.5L11 6H7L8.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  ),
  FileText: ({ className }) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2.5"
        y="1.5"
        width="9"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line
        x1="4.5"
        y1="5"
        x2="9.5"
        y2="5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="4.5"
        y1="7.5"
        x2="9.5"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="4.5"
        y1="10"
        x2="7.5"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ),
  GraduationCap: ({ className }) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M7 3.5L1.5 6.5L7 9.5L12.5 6.5L7 3.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M4 8V10.5C4 10.5 5 12 7 12C9 12 10 10.5 10 10.5V8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="12.5"
        y1="6.5"
        x2="12.5"
        y2="9.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  ),
  Activity: ({ className }) => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <polyline
        points="1,7 3.5,7 5,3.5 7,10.5 9,5.5 10.5,7 13,7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
}

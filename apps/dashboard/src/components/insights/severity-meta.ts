/**
 * Shared visual metadata for insight severities.
 *
 * Single source of truth for the label, icon, and token classes used to render
 * a severity across the insight surfaces (card, overview strip, insights-page
 * board). Keeping it here avoids each surface re-deriving colors / labels and
 * drifting — e.g. a card that says "Notice" next to a header that says "info".
 */

import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Info, TriangleAlert } from 'lucide-react'

import type { InsightSeverity } from '@/lib/insights/types'

export interface SeverityMeta {
  /** Human label shown on badges. Note: `info` reads as "Notice". */
  readonly label: string
  readonly icon: LucideIcon
  /** Background token for the icon chip. */
  readonly iconBg: string
  /** Foreground token for the icon. */
  readonly iconColor: string
  /** Tinted outline-badge classes (also used for header count badges). */
  readonly badge: string
  /** Left-border accent color (paired with `border-l-2`) to surface severity. */
  readonly accent: string
}

export const SEVERITY_META: Record<InsightSeverity, SeverityMeta> = {
  critical: {
    label: 'Critical',
    icon: AlertTriangle,
    iconBg: 'bg-rose-100 dark:bg-rose-950/50',
    iconColor: 'text-rose-600 dark:text-rose-400',
    badge:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-400',
    accent: 'border-l-rose-400 dark:border-l-rose-500',
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    iconBg: 'bg-amber-100 dark:bg-amber-950/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
    badge:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-400',
    accent: 'border-l-amber-400 dark:border-l-amber-500',
  },
  info: {
    label: 'Notice',
    icon: Info,
    iconBg: 'bg-muted',
    iconColor: 'text-muted-foreground',
    badge:
      'border-border bg-muted/50 text-muted-foreground dark:bg-muted/30 dark:text-muted-foreground',
    accent: 'border-l-border',
  },
}

/** Severity display / sort order, most severe first. */
export const SEVERITY_ORDER: readonly InsightSeverity[] = [
  'critical',
  'warning',
  'info',
]

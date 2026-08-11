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
  /**
   * Foreground token for the icon — the SINGLE severity signal on a card.
   * Everything else (surface, border, badge) stays neutral so one finding is
   * not shouted four times (see the product-design skill, non-negotiable #6).
   */
  readonly iconColor: string
  /** Neutral outline-badge classes (also used for header count badges). */
  readonly badge: string
}

export const SEVERITY_META: Record<InsightSeverity, SeverityMeta> = {
  critical: {
    label: 'Critical',
    icon: AlertTriangle,
    iconColor: 'text-rose-600 dark:text-rose-400',
    badge: 'border-border bg-transparent text-muted-foreground',
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    iconColor: 'text-amber-600 dark:text-amber-400',
    badge: 'border-border bg-transparent text-muted-foreground',
  },
  info: {
    label: 'Notice',
    icon: Info,
    iconColor: 'text-muted-foreground',
    badge: 'border-border bg-transparent text-muted-foreground',
  },
}

/** Severity display / sort order, most severe first. */
export const SEVERITY_ORDER: readonly InsightSeverity[] = [
  'critical',
  'warning',
  'info',
]

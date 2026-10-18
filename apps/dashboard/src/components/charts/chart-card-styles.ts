import { cn } from '@/lib/utils'

/** Class names shared by every chart card state (loading, empty, error, data). */
export const chartCard = {
  base: cn('flex flex-col h-full gap-2', 'border-border/50'),

  variants: {
    /** Loading and empty states - simpler appearance */
    default: cn('rounded-lg', 'bg-card/50', 'py-2', 'overflow-hidden'),

    /** Error state - applies error-specific coloring via errorClassName */
    error: cn('rounded-lg', 'bg-card/50', 'py-2', 'overflow-hidden'),

    /** Normal data state - enhanced visual treatment */
    normal: cn(
      'relative w-full min-w-0 group',
      'overflow-hidden rounded-xl',
      'bg-gradient-to-b from-card/80 to-card/40 dark:from-card/60 dark:to-card/30',
      'border dark:border-border/30',
      'backdrop-blur-xl',
      'pt-1 pb-2'
    ),
  },

  /** Card header styles - consistent across all states */
  header: 'px-2 py-1 shrink-0',

  /** Card content styles - consistent across all states */
  content: 'p-4 pt-0 flex-1 min-h-0',

  /** Compact content padding (for small/compact variants) */
  contentCompact: 'p-3 flex-1 min-h-0',

  /** Error state content (no header, so full padding) */
  contentError: 'p-4 flex-1 min-h-0',
} as const

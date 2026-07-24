'use client'

/**
 * SuggestedPrompts — the single shared rendering for the agent's suggested
 * questions, used everywhere they appear (welcome screen + settings sidebar).
 *
 * Two visual `variant`s over the SAME data + category config:
 *  - `grid` — category-tinted icon tiles (welcome / empty state, issue #2800)
 *  - `list` — compact category-tag rows (320px settings sidebar)
 *
 * Consolidates the three former renderings (`RecommendationsList`,
 * `PromptTilesGrid`, and the sidebar's inline list) into one component so the
 * category colours/icons and prompt pool never drift (issue #2809).
 */

import {
  ActivityIcon,
  AlertTriangleIcon,
  CpuIcon,
  DatabaseIcon,
  GitMergeIcon,
  HardDriveIcon,
  type LucideIcon,
  SparklesIcon,
} from 'lucide-react'

import { useEffect, useMemo, useState } from 'react'
import {
  SUGGESTED_PROMPTS,
  type SuggestedPrompt,
  shufflePrompts,
} from '@/components/agents/welcome/suggested-prompts'
import { cn } from '@/lib/utils'

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  INSIGHTS: SparklesIcon,
  SCHEMA: DatabaseIcon,
  STORAGE: HardDriveIcon,
  QUERIES: ActivityIcon,
  ERRORS: AlertTriangleIcon,
  MERGES: GitMergeIcon,
  SYSTEM: CpuIcon,
}

export const CATEGORY_COLORS: Record<string, string> = {
  INSIGHTS: 'bg-[var(--chart-1)]/10 text-[var(--chart-1)]',
  SCHEMA: 'bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]',
  STORAGE: 'bg-[var(--chart-yellow)]/10 text-[var(--chart-yellow)]',
  QUERIES: 'bg-[var(--chart-green)]/10 text-[var(--chart-green)]',
  ERRORS: 'bg-[var(--chart-red)]/10 text-[var(--chart-red)]',
  MERGES: 'bg-[var(--chart-2)]/10 text-[var(--chart-2)]',
  SYSTEM: 'bg-muted text-muted-foreground',
}

interface SuggestedPromptsProps {
  onPickPrompt?: (prompt: string) => void
  /** `grid` = icon tiles, `list` = compact tag rows. */
  variant?: 'grid' | 'list'
  /** Max prompts to show (before "Show more" for a collapsible list). */
  limit?: number
  /**
   * Shuffle the pool after mount (welcome screens want variety; the deterministic
   * sidebar list keeps its order). Shuffling happens post-mount so it never trips
   * a hydration mismatch against the prerendered shell.
   */
  shuffle?: boolean
  /** Wrap the section in a heading (welcome). Off for the sidebar (its section
   *  chrome supplies the heading). */
  withHeading?: boolean
  /** Allow expanding past `limit` with a "Show more" toggle (sidebar list). */
  collapsible?: boolean
  className?: string
}

function usePromptPool(shuffle: boolean): readonly SuggestedPrompt[] {
  const [pool, setPool] =
    useState<readonly SuggestedPrompt[]>(SUGGESTED_PROMPTS)
  useEffect(() => {
    if (shuffle) setPool(shufflePrompts(SUGGESTED_PROMPTS))
  }, [shuffle])
  return pool
}

export function SuggestedPrompts({
  onPickPrompt,
  variant = 'grid',
  limit,
  shuffle = variant === 'grid',
  withHeading = variant === 'grid',
  collapsible = false,
  className,
}: SuggestedPromptsProps) {
  const pool = usePromptPool(shuffle)
  const [expanded, setExpanded] = useState(false)

  const visible = useMemo(() => {
    if (!collapsible) {
      return typeof limit === 'number' && limit > 0
        ? pool.slice(0, limit)
        : pool
    }
    if (expanded) return pool
    return typeof limit === 'number' && limit > 0 ? pool.slice(0, limit) : pool
  }, [pool, limit, collapsible, expanded])

  const canToggle =
    collapsible && typeof limit === 'number' && pool.length > limit

  const body =
    variant === 'grid' ? (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((entry, index) => {
          const colorClass =
            CATEGORY_COLORS[entry.category] ?? 'bg-muted text-muted-foreground'
          const Icon = CATEGORY_ICONS[entry.category] ?? SparklesIcon
          return (
            <button
              key={entry.title}
              type="button"
              onClick={() => onPickPrompt?.(entry.prompt)}
              style={{ animationDelay: `${index * 40}ms` }}
              className="hover:bg-muted/40 hover:border-border active:scale-[0.99] group flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left shadow-sm transition-[transform,background-color,border-color] duration-150 touch-manipulation animate-in fade-in-0 slide-in-from-bottom-1"
            >
              <span
                className={cn(
                  'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
                  colorClass
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-foreground">
                  {entry.title}
                </span>
                <span className="text-muted-foreground line-clamp-2 text-[11.5px] leading-snug">
                  {entry.prompt}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    ) : (
      <div className="space-y-1.5 text-[11.5px]">
        {visible.map((entry) => (
          <button
            key={entry.title}
            type="button"
            onClick={() => onPickPrompt?.(entry.prompt)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 -mx-1 flex w-[calc(100%+0.5rem)] items-start gap-1.5 rounded px-1 py-0.5 text-left transition-colors"
          >
            <span className="text-foreground w-14 shrink-0 pt-0.5 text-[9.5px] font-semibold tracking-wider uppercase">
              {entry.category}
            </span>
            <span className="line-clamp-2 leading-snug">{entry.prompt}</span>
          </button>
        ))}
      </div>
    )

  const content = (
    <>
      {body}
      {canToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground mt-2 text-[10.5px]"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )

  if (!withHeading) return <div className={className}>{content}</div>

  return (
    <section className={cn('mb-8', className)}>
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Suggested questions
        </h3>
        <p className="text-muted-foreground text-[11.5px]">
          Pick one to get started, or write your own.
        </p>
      </div>
      {content}
    </section>
  )
}

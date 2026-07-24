'use client'

/**
 * Recommendation prompts shown on the AI Agent welcome screen, replacing the
 * old skills capability grid. Each row pairs a short category tag with a
 * full-text prompt; clicking the row submits the prompt immediately.
 */

import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CpuIcon,
  DatabaseIcon,
  GitMergeIcon,
  HardDriveIcon,
  type LucideIcon,
  SparklesIcon,
} from 'lucide-react'

import { useEffect, useState } from 'react'
import {
  SUGGESTED_PROMPTS,
  type SuggestedPrompt,
  shufflePrompts,
} from '@/components/agents/welcome/suggested-prompts'
import { cn } from '@/lib/utils'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  INSIGHTS: SparklesIcon,
  SCHEMA: DatabaseIcon,
  STORAGE: HardDriveIcon,
  QUERIES: ActivityIcon,
  ERRORS: AlertTriangleIcon,
  MERGES: GitMergeIcon,
  SYSTEM: CpuIcon,
}

const CATEGORY_COLORS: Record<string, string> = {
  INSIGHTS: 'bg-[var(--chart-1)]/10 text-[var(--chart-1)]',
  SCHEMA: 'bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]',
  STORAGE: 'bg-[var(--chart-yellow)]/10 text-[var(--chart-yellow)]',
  QUERIES: 'bg-[var(--chart-green)]/10 text-[var(--chart-green)]',
  ERRORS: 'bg-[var(--chart-red)]/10 text-[var(--chart-red)]',
  MERGES: 'bg-[var(--chart-2)]/10 text-[var(--chart-2)]',
  SYSTEM: 'bg-muted text-muted-foreground',
}

interface RecommendationsListProps {
  onPickPrompt?: (prompt: string) => void
  limit?: number
}

export function RecommendationsList({
  onPickPrompt,
  limit,
}: RecommendationsListProps) {
  // Shuffle after mount, not during render: the welcome screen is part of the
  // prerendered static shell, so a random order at render time would not match
  // the server HTML and would trip a hydration mismatch.
  const [pool, setPool] =
    useState<readonly SuggestedPrompt[]>(SUGGESTED_PROMPTS)
  useEffect(() => {
    setPool(shufflePrompts(SUGGESTED_PROMPTS))
  }, [])

  const prompts =
    typeof limit === 'number' && limit > 0 ? pool.slice(0, limit) : pool

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Suggested questions
        </h3>
        <p className="text-muted-foreground text-[11.5px]">
          Pick one to get started, or write your own.
        </p>
      </div>

      <div className="divide-border divide-y rounded-lg border border-border/60">
        {prompts.map((entry, index) => {
          const colorClass =
            CATEGORY_COLORS[entry.category] ?? 'bg-muted text-muted-foreground'
          return (
            <button
              key={entry.title}
              type="button"
              onClick={() => onPickPrompt?.(entry.prompt)}
              style={{ animationDelay: `${index * 40}ms` }}
              className="hover:bg-muted/40 active:scale-[0.995] group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-[transform,background-color] duration-150 first:rounded-t-lg last:rounded-b-lg touch-manipulation animate-in fade-in-0 slide-in-from-bottom-1"
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold leading-[14px] tracking-wider uppercase',
                  colorClass
                )}
              >
                {entry.category}
              </span>
              <span className="text-foreground/90 min-w-0 flex-1 text-[12.5px] leading-snug">
                {entry.prompt}
              </span>
              <ArrowRightIcon className="text-muted-foreground/60 group-hover:text-foreground mt-1 size-3 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Example-prompt tile grid for the welcome/empty state (issue #2800): each tile
 * pairs a category-tinted icon with a short title + full-prompt subtitle.
 * Clicking a tile fills the composer. A visual alternative to the flat
 * {@link RecommendationsList}; both draw from the same SUGGESTED_PROMPTS pool.
 */
export function PromptTilesGrid({
  onPickPrompt,
  limit = 6,
}: RecommendationsListProps) {
  const [pool, setPool] =
    useState<readonly SuggestedPrompt[]>(SUGGESTED_PROMPTS)
  useEffect(() => {
    setPool(shufflePrompts(SUGGESTED_PROMPTS))
  }, [])

  const prompts =
    typeof limit === 'number' && limit > 0 ? pool.slice(0, limit) : pool

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Suggested questions
        </h3>
        <p className="text-muted-foreground text-[11.5px]">
          Pick one to get started, or write your own.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((entry, index) => {
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
    </section>
  )
}

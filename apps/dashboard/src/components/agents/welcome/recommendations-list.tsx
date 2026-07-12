'use client'

/**
 * Recommendation prompts shown on the AI Agent welcome screen, replacing the
 * old skills capability grid. Each row pairs a short category tag with a
 * full-text prompt; clicking the row submits the prompt immediately.
 */

import { ArrowRightIcon } from 'lucide-react'

import { useEffect, useState } from 'react'
import {
  SUGGESTED_PROMPTS,
  type SuggestedPrompt,
  shufflePrompts,
} from '@/components/agents/welcome/suggested-prompts'
import { cn } from '@/lib/utils'

const CATEGORY_COLORS: Record<string, string> = {
  INSIGHTS:
    'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  SCHEMA: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  STORAGE:
    'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  QUERIES:
    'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  ERRORS: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  MERGES: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400',
  SYSTEM:
    'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400',
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

'use client'

/**
 * Deterministic follow-up chips.
 *
 * Renders 2-3 rule-based next-step suggestions (from
 * `lib/ai/agent/follow-up-prompts.ts`) as clickable chips. Unlike
 * `FollowUpSuggestions` (which fetches LLM-generated follow-ups from an
 * AI-enriched conversation backend), these are computed instantly, client-side,
 * from the last exchange — so they render for every backend, including
 * localStorage-only threads.
 */

import { cn } from '@/lib/utils'

interface FollowUpChipsProps {
  /** Suggestion strings to render, in order. Renders nothing when empty. */
  prompts: readonly string[]
  /** Called with the chip's text when clicked. */
  onSelect: (text: string) => void
  className?: string
}

export function FollowUpChips({
  prompts,
  onSelect,
  className,
}: FollowUpChipsProps) {
  if (prompts.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="border-border text-foreground hover:bg-muted/60 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors"
        >
          {prompt}
        </button>
      ))}
    </div>
  )
}

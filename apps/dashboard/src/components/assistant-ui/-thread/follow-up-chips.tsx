'use client'

/**
 * Deterministic follow-up chips.
 *
 * Renders up to 3 rule-based next-step suggestions (from
 * `lib/ai/agent/follow-up-prompts.ts`) as clickable chips. Unlike
 * `FollowUpSuggestions` (which fetches LLM-generated follow-ups from an
 * AI-enriched conversation backend), these are computed instantly, client-side,
 * from the last exchange — so they render for every backend, including
 * localStorage-only threads.
 *
 * Also reused by `FollowUpSuggestions` to render its AI-generated questions,
 * so both follow-up affordances share one chip look.
 */

import { cn } from '@/lib/utils'

interface FollowUpChipsProps {
  /** Suggestion strings to render, in order. Renders nothing when empty. */
  prompts: readonly string[]
  /** Called with the chip's text when clicked. */
  onSelect: (text: string) => void
  /**
   * Adds a top divider + padding so the strip reads as its own anchored row
   * rather than a loose set of pills floating in whatever it's dropped into.
   * `FollowUpSuggestions` already provides its own top border on the
   * surrounding column (it also has to cover the "Suggested follow-ups"
   * button state), so it leaves this off to avoid a doubled-up divider;
   * `AssistantFollowUpChips` (rendered inline under a message, with nothing
   * else providing that separation) turns it on.
   */
  anchored?: boolean
  className?: string
}

export function FollowUpChips({
  prompts,
  onSelect,
  anchored = false,
  className,
}: FollowUpChipsProps) {
  if (prompts.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5',
        anchored && 'border-border/60 border-t pt-2',
        className
      )}
    >
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="border-border/70 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring/50 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {prompt}
        </button>
      ))}
    </div>
  )
}

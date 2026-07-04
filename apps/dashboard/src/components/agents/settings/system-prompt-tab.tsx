'use client'

/**
 * System Prompt tab — `/agents/settings`.
 *
 * Read-only view of the instructions sent to the model on every request
 * (`CLICKHOUSE_AGENT_INSTRUCTIONS`). There is no per-user override today — the
 * prompt is a fixed, versioned asset (see `lib/ai/agent/prompts/`) that ships
 * with the dashboard — so this is visibility, not an editor.
 *
 * Imported directly (not fetched from an API): the assembled instructions are
 * a plain string constant with no server-only dependencies. It ships with the
 * `/agents/settings` route chunk (code-split from the rest of the app like
 * every other route) rather than a separate per-tab chunk — the ~5-6k tokens
 * of prompt text only load when a user visits this page, not on every page.
 */

import { ScrollArea } from '@/components/ui/scroll-area'
import { CLICKHOUSE_AGENT_INSTRUCTIONS } from '@/lib/ai/agent/prompts/clickhouse-instructions'

export function SystemPromptTab() {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-[11.5px] leading-snug">
        The instructions sent to the model at the start of every conversation.
        Fixed for now — there is no per-user override.
      </p>
      <ScrollArea className="bg-muted/20 h-[480px] rounded-md border">
        <pre className="whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed">
          {CLICKHOUSE_AGENT_INSTRUCTIONS}
        </pre>
      </ScrollArea>
    </div>
  )
}

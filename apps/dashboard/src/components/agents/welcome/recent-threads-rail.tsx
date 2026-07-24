'use client'

/**
 * Recent threads list on the AI Agent welcome screen.
 *
 * Renders the SAME {@link ThreadRow} over the SAME {@link useConversationItems}
 * data as the persistent conversation rail — the single consolidated thread
 * rendering (issue #2809). Here it's a compact "most recent N" strip; the rail
 * adds search + date grouping.
 */

import {
  ThreadRow,
  useConversationItems,
} from '@/components/assistant-ui/conversation-rail'

const RECENT_LIMIT = 5

export function RecentThreadsRail() {
  const items = useConversationItems()
  const recent = items.slice(0, RECENT_LIMIT)

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-muted-foreground text-[11px] font-medium tracking-[0.06em] uppercase">
          Recent threads
        </h3>
        {items.length > 0 && (
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {items.length} {items.length === 1 ? 'thread' : 'threads'}
          </span>
        )}
      </div>

      {recent.length === 0 ? (
        <div className="border-border/60 rounded-lg border">
          <div className="text-muted-foreground px-3 py-8 text-center text-[12px]">
            No conversations yet. Start one above.
          </div>
        </div>
      ) : (
        <div className="border-border/60 flex flex-col gap-0.5 rounded-lg border p-1">
          {recent.map((item) => (
            <ThreadRow key={item.id} item={item} showActions={false} />
          ))}
        </div>
      )}
    </section>
  )
}

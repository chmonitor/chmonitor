'use client'

import { NEW_TABLE_TIPS } from '@/lib/ai/advisor/schema-tree'

export function NewTableTips() {
  return (
    <div className="space-y-3" data-testid="advisor-new-table-tips">
      <h3 className="text-sm font-medium text-foreground">
        Tips for creating new tables
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {NEW_TABLE_TIPS.map((tip) => (
          <li
            key={tip.title}
            className="rounded-xl border bg-card p-3 shadow-sm"
          >
            <p className="text-[13px] font-medium text-foreground">
              {tip.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{tip.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

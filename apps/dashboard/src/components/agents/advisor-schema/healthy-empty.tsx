'use client'

import { NewTableTips } from './new-table-tips'
import { EmptyState } from '@/components/ui/empty-state'

export function HealthyEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="advisor-schema-healthy">
      <div className="rounded-xl border border-dashed bg-card/40 px-6 py-8">
        <EmptyState variant="no-data" title={title} description={description} />
      </div>
      <NewTableTips />
    </div>
  )
}

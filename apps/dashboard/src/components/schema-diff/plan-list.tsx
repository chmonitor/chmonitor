import { CopyIcon } from 'lucide-react'

import type { PlanItem } from '@/lib/schema-diff'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface PlanListProps {
  items: PlanItem[]
}

function riskLabel(risk: PlanItem['risk']): string {
  if (risk === 'lightweight') return 'Lightweight'
  if (risk === 'mutation') return 'Mutation'
  return 'Manual rewrite'
}

export function PlanList({ items }: PlanListProps) {
  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardContent className="p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">
          Recommended change plan
        </h2>
        {items.length === 0 ? (
          <EmptyState
            variant="no-data"
            compact
            title="No recommended statements"
            description="This table matches, or every delta is a manual rewrite."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm">{item.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {riskLabel(item.risk)}
                      {item.safe ? ' · safe to copy' : ''}
                    </p>
                  </div>
                  {item.statement ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={() => copyToClipboard(item.statement)}
                    >
                      <CopyIcon className="size-3.5" strokeWidth={1.5} />
                      Copy
                    </Button>
                  ) : null}
                </div>
                {item.statement ? (
                  <pre className="mt-2 overflow-x-auto font-mono text-xs text-muted-foreground">
                    {item.statement}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

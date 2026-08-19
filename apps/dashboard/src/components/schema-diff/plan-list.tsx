import type { PlanItem } from '@/lib/schema-diff'

import { RecommendDdlBlocks } from '@/components/ddl/recommend-ddl-blocks'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

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
                <div>
                  <p className="text-sm">{item.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {riskLabel(item.risk)}
                    {item.safe ? ' · safe to copy' : ''}
                  </p>
                </div>
                {item.statement ? (
                  <div className="mt-2">
                    <RecommendDdlBlocks
                      statement={item.statement}
                      onClusterStatement={item.onClusterStatement}
                      localTableName={item.localTableName}
                      localOnlyReason={item.localOnlyReason}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

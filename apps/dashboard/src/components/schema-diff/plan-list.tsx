import { CheckIcon, CopyIcon } from 'lucide-react'

import type { PlanItem } from '@/lib/schema-diff'

import { RecommendDdlBlocks } from '@/components/ddl/recommend-ddl-blocks'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

interface PlanListProps {
  items: PlanItem[]
  onCopyRecommended?: () => void
  copyRecommendedLabel?: string
  copyRecommendedDisabled?: boolean
}

function riskLabel(risk: PlanItem['risk']): string {
  if (risk === 'lightweight') return 'Lightweight'
  if (risk === 'mutation') return 'Mutation'
  return 'Manual rewrite'
}

export function PlanList({
  items,
  onCopyRecommended,
  copyRecommendedLabel = 'Copy recommended SQL',
  copyRecommendedDisabled = false,
}: PlanListProps) {
  return (
    <Card className="rounded-xl border bg-card py-0 shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">
            Recommended change plan
          </h2>
          {onCopyRecommended ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopyRecommended}
              disabled={copyRecommendedDisabled}
              aria-label="Copy recommended SQL"
              className="h-7 shrink-0 text-[13px]"
            >
              {copyRecommendedLabel === 'Copied' ? (
                <CheckIcon className="size-3.5" strokeWidth={1.5} />
              ) : (
                <CopyIcon className="size-3.5" strokeWidth={1.5} />
              )}
              {copyRecommendedLabel}
            </Button>
          ) : null}
        </div>
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

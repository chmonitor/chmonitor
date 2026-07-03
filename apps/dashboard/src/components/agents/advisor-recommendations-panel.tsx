'use client'

/**
 * Renders ranked query-advisor recommendations (skip-index, projection,
 * partition key, PREWHERE rewrite) — shared by the agent chat tool-output
 * renderer (`components/agents/chat/tool-output.tsx`, keyed on
 * `type: 'query_advisor_recommendations'`) and the `/advisor` page.
 *
 * Recommend-only: shows a "copy" button for the DDL/rewrite text
 * (`CodeBlockCopyButton`) — there is no "apply" action anywhere in this
 * component. See plans/46-query-advisor-engine.md.
 */

import {
  DatabaseZapIcon,
  FilterIcon,
  LayersIcon,
  WandSparklesIcon,
} from 'lucide-react'

import type { Recommendation } from '@/lib/ai/advisor/recommendation-engine'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Same rose/amber/sky severity triad used elsewhere for graded status
// (see components/agents/agent-diagnostics.tsx's SEVERITY_CLASS).
const RISK_CLASS: Record<Recommendation['risk'], string> = {
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  medium:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

const KIND_ICON: Record<Recommendation['kind'], typeof FilterIcon> = {
  skip_index: FilterIcon,
  projection: LayersIcon,
  partition_key: DatabaseZapIcon,
  prewhere: WandSparklesIcon,
}

const KIND_LABEL: Record<Recommendation['kind'], string> = {
  skip_index: 'Skip index',
  projection: 'Projection',
  partition_key: 'Partition key',
  prewhere: 'PREWHERE rewrite',
}

function RiskBadge({ risk }: { risk: Recommendation['risk'] }) {
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 text-[10px]', RISK_CLASS[risk])}
    >
      {risk} risk
    </Badge>
  )
}

function RecommendationCard({
  recommendation,
}: {
  recommendation: Recommendation
}) {
  const Icon = KIND_ICON[recommendation.kind]
  const code = recommendation.ddl ?? recommendation.rewrittenSql ?? ''

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {recommendation.title}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {recommendation.rationale}
            </div>
          </div>
        </div>
        <RiskBadge risk={recommendation.risk} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {KIND_LABEL[recommendation.kind]}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {recommendation.effort} effort
        </Badge>
      </div>

      <div className="rounded bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">
        {recommendation.estImpact.summary}
      </div>

      {code ? (
        <CodeBlock code={code} language="sql" className="max-h-56 text-xs">
          <CodeBlockCopyButton />
        </CodeBlock>
      ) : null}

      <div className="text-xs text-muted-foreground">
        {recommendation.riskNote}
      </div>
    </div>
  )
}

export interface AdvisorRecommendationsOutput {
  sql: string
  database: string
  table: string
  recommendations: Recommendation[]
  notes: string[]
}

export function AdvisorRecommendationsPanel({
  output,
}: {
  output: AdvisorRecommendationsOutput
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <WandSparklesIcon className="size-4 text-primary" />
          <span className="truncate text-sm font-semibold">
            Optimization advisor: {output.database}.{output.table}
          </span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {output.recommendations.length} recommendation
          {output.recommendations.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {output.notes.length > 0 ? (
        <div className="space-y-1 border-b border-border/40 p-3">
          {output.notes.map((note) => (
            <div key={note} className="text-xs text-muted-foreground">
              {note}
            </div>
          ))}
        </div>
      ) : null}

      <div className="divide-y divide-border/40">
        {output.recommendations.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No optimization recommendations found for this query — it may
            already be well-tuned for this table's schema.
          </div>
        ) : (
          output.recommendations.map((recommendation) => (
            <RecommendationCard
              key={`${recommendation.kind}-${recommendation.title}`}
              recommendation={recommendation}
            />
          ))
        )}
      </div>
    </div>
  )
}

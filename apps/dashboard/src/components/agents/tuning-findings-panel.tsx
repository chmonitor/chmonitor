'use client'

/**
 * Renders ranked schema + settings tuning findings — shared by the agent chat
 * tool-output renderer (`components/agents/chat/tool-output.tsx`, keyed on
 * `type: 'schema_tuning_findings'`) and the `/advisor` page's "Schema &
 * Settings" tab.
 *
 * Recommend-only: each finding shows a "copy" button for its ready-to-review
 * DDL/statement and (when present) a verification query. There is no "apply"
 * action anywhere in this component. See issue #2764.
 */

import {
  DatabaseZapIcon,
  GaugeIcon,
  HashIcon,
  ShrinkIcon,
  SlidersHorizontalIcon,
  WandSparklesIcon,
} from 'lucide-react'

import type { TuningFinding } from '@/lib/ai/advisor/tuning/types'

import { useEffect, useRef } from 'react'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Badge } from '@/components/ui/badge'
import { trackEvent } from '@/lib/analytics/analytics'
import { cn } from '@/lib/utils'

// Same rose/amber/sky severity triad used by the query advisor panel.
const SEVERITY_CLASS: Record<TuningFinding['severity'], string> = {
  high: 'border-destructive/30 bg-destructive/10 text-destructive',
  medium:
    'border-[var(--chart-yellow)]/30 bg-[var(--chart-yellow)]/10 text-[var(--chart-yellow)]',
  low: 'border-[var(--chart-blue)]/30 bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]',
}

const RULE_ICON: Record<TuningFinding['ruleId'], typeof HashIcon> = {
  nullable_column: DatabaseZapIcon,
  oversized_integer: HashIcon,
  compression_codec: ShrinkIcon,
  low_cardinality: GaugeIcon,
  setting_tuning: SlidersHorizontalIcon,
}

const RULE_LABEL: Record<TuningFinding['ruleId'], string> = {
  nullable_column: 'Nullable',
  oversized_integer: 'Oversized int',
  compression_codec: 'Codec',
  low_cardinality: 'LowCardinality',
  setting_tuning: 'Setting',
}

function SeverityBadge({ severity }: { severity: TuningFinding['severity'] }) {
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 text-[10px]', SEVERITY_CLASS[severity])}
    >
      {severity}
    </Badge>
  )
}

function FindingCard({ finding }: { finding: TuningFinding }) {
  const Icon = RULE_ICON[finding.ruleId]

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {finding.title}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {finding.rationale}
            </div>
          </div>
        </div>
        <SeverityBadge severity={finding.severity} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {RULE_LABEL[finding.ruleId]}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {finding.risk} risk
        </Badge>
      </div>

      <div className="rounded bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground/80">Evidence:</span>{' '}
          {finding.evidence}
        </div>
        <div className="mt-1">
          <span className="font-medium text-foreground/80">
            Estimated benefit:
          </span>{' '}
          {finding.estimatedBenefit}
        </div>
      </div>

      <CodeBlock code={finding.ddl} language="sql" className="max-h-56 text-xs">
        <CodeBlockCopyButton />
      </CodeBlock>

      {finding.verifyQuery ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">
            Verify before applying:
          </div>
          <CodeBlock
            code={finding.verifyQuery}
            language="sql"
            className="max-h-40 text-xs"
          >
            <CodeBlockCopyButton />
          </CodeBlock>
        </div>
      ) : null}

      <div className="text-xs text-muted-foreground">{finding.riskNote}</div>
    </div>
  )
}

export interface TuningFindingsOutput {
  database: string
  table?: string
  findings: TuningFinding[]
  notes: string[]
}

export function TuningFindingsPanel({
  output,
}: {
  output: TuningFindingsOutput
}) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current || output.findings.length === 0) return
    fired.current = true
    trackEvent('advisor_tuning_viewed', {
      finding_count: output.findings.length,
    })
  }, [output.findings.length])

  const scope = output.table
    ? `${output.database}.${output.table}`
    : output.database

  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <WandSparklesIcon className="size-4 text-primary" />
          <span className="truncate text-sm font-semibold">
            Fine-tune advisor: {scope}
          </span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {output.findings.length} finding
          {output.findings.length === 1 ? '' : 's'}
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
        {output.findings.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No schema or settings tuning opportunities found — the scanned
            columns and changed settings look well-tuned.
          </div>
        ) : (
          output.findings.map((finding) => (
            <FindingCard
              key={`${finding.ruleId}-${finding.target}`}
              finding={finding}
            />
          ))
        )}
      </div>
    </div>
  )
}

'use client'

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  FileCode2Icon,
  LightbulbIcon,
  ShieldAlertIcon,
} from 'lucide-react'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Severity = 'info' | 'warning' | 'critical'

interface AgentIssue {
  id: string
  severity: Severity
  category: string
  title: string
  evidence: string
  recommendation: string
  confidence: 'confirmed' | 'suspected'
  rule?: string
  sampleSql?: string
}

interface AgentIssuesOutput {
  checkedAt: string
  hostId: number
  lastHours: number
  issueCount: number
  issues: AgentIssue[]
}

interface QueryRepairOutput {
  status: 'blocked' | 'repaired' | 'checked'
  originalSql: string
  fixedSql: string | null
  error?: string
  confidence: 'confirmed' | 'suspected'
  changes: string[]
  recommendations: string[]
}

interface DesignRecommendation {
  priority: Severity
  category: string
  title: string
  rationale: string
  confidence: 'confirmed' | 'suspected'
  rule: string
  proposedSql?: string
}

interface TableDesignOutput {
  table: string
  lastDays: number
  suggestedOrderBy: string[]
  recommendations: DesignRecommendation[]
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning:
    'border-[var(--chart-yellow)]/30 bg-[var(--chart-yellow)]/10 text-[var(--chart-yellow)]',
  info: 'border-[var(--chart-blue)]/30 bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]',
}

const SEVERITY_ICON: Record<Severity, typeof AlertTriangleIcon> = {
  critical: ShieldAlertIcon,
  warning: AlertTriangleIcon,
  info: LightbulbIcon,
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 text-[10px]', SEVERITY_CLASS[severity])}
    >
      {severity}
    </Badge>
  )
}

function SqlBlock({ sql }: { sql: string }) {
  return (
    <CodeBlock code={sql} language="sql" className="max-h-56 text-xs">
      <CodeBlockCopyButton />
    </CodeBlock>
  )
}

export function AgentIssuesPanel({ output }: { output: AgentIssuesOutput }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangleIcon className="size-4 text-[var(--chart-yellow)]" />
          <span className="text-sm font-semibold">Issue scan</span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {output.issueCount} issues - {output.lastHours}h
        </Badge>
      </div>

      {output.issues.length === 0 ? (
        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <CheckCircle2Icon className="size-4 text-[var(--chart-green)]" />
          No confirmed issues found in the selected window.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {output.issues.map((issue) => {
            const Icon = SEVERITY_ICON[issue.severity]
            return (
              <div key={issue.id} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {issue.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {issue.evidence}
                      </div>
                    </div>
                  </div>
                  <SeverityBadge severity={issue.severity} />
                </div>
                <div className="rounded bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">
                  {issue.recommendation}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">
                    {issue.category}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {issue.confidence}
                  </Badge>
                  {issue.rule ? (
                    <Badge variant="outline" className="text-[10px]">
                      {issue.rule}
                    </Badge>
                  ) : null}
                </div>
                {issue.sampleSql ? <SqlBlock sql={issue.sampleSql} /> : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function QueryRepairPanel({ output }: { output: QueryRepairOutput }) {
  const isBlocked = output.status === 'blocked'
  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileCode2Icon className="size-4 text-primary" />
          <span className="text-sm font-semibold">Query repair</span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            isBlocked
              ? SEVERITY_CLASS.critical
              : output.status === 'repaired'
                ? SEVERITY_CLASS.warning
                : SEVERITY_CLASS.info
          )}
        >
          {output.status}
        </Badge>
      </div>

      {output.error ? (
        <div className="rounded bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          {output.error}
        </div>
      ) : null}

      {output.fixedSql ? (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Candidate SQL
          </div>
          <SqlBlock sql={output.fixedSql} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Checked SQL
          </div>
          <SqlBlock sql={output.originalSql} />
        </div>
      )}

      {output.changes.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            Changes
          </div>
          {output.changes.map((change) => (
            <div key={change} className="text-xs text-muted-foreground">
              {change}
            </div>
          ))}
        </div>
      ) : null}

      {output.recommendations.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            Recommendations
          </div>
          {output.recommendations.map((recommendation) => (
            <div key={recommendation} className="text-xs text-muted-foreground">
              {recommendation}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function TableDesignPanel({ output }: { output: TableDesignOutput }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <DatabaseIcon className="size-4 text-primary" />
          <span className="truncate text-sm font-semibold">
            Table design: {output.table}
          </span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {output.lastDays}d
        </Badge>
      </div>

      {output.suggestedOrderBy.length > 0 ? (
        <div className="border-b border-border/40 p-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Suggested ORDER BY candidates
          </div>
          <div className="flex flex-wrap gap-1.5">
            {output.suggestedOrderBy.map((column) => (
              <Badge key={column} variant="secondary" className="text-[10px]">
                {column}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-border/40">
        {output.recommendations.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No table-design recommendations found from available evidence.
          </div>
        ) : (
          output.recommendations.map((recommendation) => (
            <div
              key={`${recommendation.category}-${recommendation.title}`}
              className="space-y-2 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {recommendation.title}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {recommendation.rationale}
                  </div>
                </div>
                <SeverityBadge severity={recommendation.priority} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  {recommendation.category}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {recommendation.confidence}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {recommendation.rule}
                </Badge>
              </div>
              {recommendation.proposedSql ? (
                <SqlBlock sql={recommendation.proposedSql} />
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

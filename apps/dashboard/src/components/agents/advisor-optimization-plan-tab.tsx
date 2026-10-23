/**
 * Advisor "Optimization plan" tab (#4071): a ranked, recommend-only plan built
 * from the findings the advisors already stored. DDL is copy-only through
 * `RecommendDdlBlocks`; there is no run or apply control.
 */

import { useQuery } from '@tanstack/react-query'

import type {
  Plan,
  PlanItem,
  PlanRisk,
} from '@/lib/ai/advisor/optimization-plan/schema'
import type { InsightSeverity } from '@/lib/insights/types'

import { useState } from 'react'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { ChartError } from '@/components/charts/chart-error'
import { RecommendDdlBlocks } from '@/components/ddl/recommend-ddl-blocks'
import { SEVERITY_META } from '@/components/insights/severity-meta'
import { TableSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { planToMarkdown } from '@/lib/ai/advisor/optimization-plan/markdown'
import { NOT_APPLIED_BANNER } from '@/lib/ai/advisor/optimization-plan/schema'
import { formatReadableSize } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

interface PlanResponse {
  plan: Plan | null
  unavailable?: { reason: string; message: string }
}

const RISK_SEVERITY: Record<PlanRisk, InsightSeverity> = {
  high: 'critical',
  medium: 'warning',
  low: 'info',
}

async function fetchPlan(hostId: number): Promise<PlanResponse> {
  const res = await apiFetch(`/api/v1/advisor/optimization-plan?host=${hostId}`)
  if (!res.ok) throw new Error(`Could not build the plan (HTTP ${res.status})`)
  return (await res.json()) as PlanResponse
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const size = (b: number | null) =>
  b == null ? 'not measured' : formatReadableSize(b, 2)

function cost(item: PlanItem): string {
  const { kind, estHours } = item.applyCost
  if (kind === 'none') return 'review'
  return estHours == null ? kind : `${kind} · ${estHours} h`
}

function SqlBlock({ label, sql }: { label: string; sql?: string }) {
  if (!sql) return null
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <CodeBlock code={sql} language="sql" className="max-h-56 text-xs">
        <CodeBlockCopyButton />
      </CodeBlock>
    </div>
  )
}

function PlanRow({ item }: { item: PlanItem }) {
  const meta = SEVERITY_META[RISK_SEVERITY[item.risk]]
  const Icon = meta.icon
  return (
    <details className="group border-b last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 text-sm pointer-coarse:min-h-11 sm:grid-cols-[2rem_1fr_8rem_8rem_9rem_7rem]">
        <span className="text-muted-foreground tabular-nums">{item.rank}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{item.title}</span>
          {item.needsOwnerApproval ? (
            <span className="text-xs text-muted-foreground">
              Needs owner approval
            </span>
          ) : null}
        </span>
        <span className="hidden truncate text-muted-foreground sm:block">
          {item.owner ?? 'unknown'}
        </span>
        <span className="hidden tabular-nums sm:block">
          {size(item.savedBytes)}
        </span>
        <span className="hidden text-muted-foreground sm:block">
          {cost(item)}
        </span>
        <span className="flex items-center gap-1.5 justify-self-end sm:justify-self-start">
          <Icon className={`size-3.5 ${meta.iconColor}`} strokeWidth={1.5} />
          <span className="text-xs capitalize">{item.risk}</span>
        </span>
      </summary>
      <div className="space-y-3 px-4 pb-4 sm:pl-14">
        <div className="text-xs text-muted-foreground sm:hidden">
          Owner {item.owner ?? 'unknown'} · saves {size(item.savedBytes)} ·{' '}
          {cost(item)}
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">
            Evidence
          </div>
          <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
            {item.evidence}
          </pre>
        </div>
        {item.ddl.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">
              DDL in apply order{item.reversible ? '' : ' · not reversible'}
            </div>
            <RecommendDdlBlocks statement={item.ddl.join(';\n')} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No DDL: this item is a review for the owner.
          </p>
        )}
        <SqlBlock label="Evidence SQL" sql={item.evidenceSql} />
        <SqlBlock label="Verify" sql={item.verifySql} />
        <SqlBlock label="Rollback" sql={item.rollbackSql} />
      </div>
    </details>
  )
}

function PlanView({ plan }: { plan: Plan }) {
  const measured = plan.items.reduce((sum, i) => sum + (i.savedBytes ?? 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">{formatReadableSize(measured, 2)}</span>{' '}
          <span className="text-muted-foreground">
            measured savings · {plan.items.length} items · {plan.skipped.length}{' '}
            skipped
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              download(
                `optimization-plan-host-${plan.hostId}.md`,
                'text/markdown',
                planToMarkdown(plan)
              )
            }
          >
            Export Markdown
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              download(
                `optimization-plan-host-${plan.hostId}.json`,
                'application/json',
                JSON.stringify(plan, null, 2)
              )
            }
          >
            Export JSON
          </Button>
        </div>
      </div>

      {plan.items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-10">
          <EmptyState
            variant="no-data"
            title="No optimizations found"
            description={
              plan.collectorsRan.length > 0
                ? `Read stored findings from: ${plan.collectorsRan.join(', ')}.`
                : 'No advisor findings were stored for this host yet. Generate insights, then reload this tab.'
            }
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="hidden grid-cols-[2rem_1fr_8rem_8rem_9rem_7rem] gap-3 border-b px-4 py-2 text-xs text-muted-foreground sm:grid">
            <span>#</span>
            <span>Item</span>
            <span>Owner</span>
            <span>Saves</span>
            <span>Cost</span>
            <span>Risk</span>
          </div>
          {plan.items.map((item) => (
            <PlanRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {plan.skipped.length > 0 || plan.testedAndRejected.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {plan.skipped.map((s) => (
            <li key={`skip-${s.collector}`}>
              Skipped {s.collector}: {s.reason}
            </li>
          ))}
          {plan.testedAndRejected.map((r) => (
            <li key={`rej-${r.item.id}`}>
              Rejected {r.item.title}: {r.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function AdvisorOptimizationPlanTab() {
  const hostId = useHostId()
  const [requested, setRequested] = useState(false)
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['optimization-plan', hostId],
    queryFn: () => fetchPlan(hostId),
    enabled: requested,
  })

  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="rounded-lg border px-4 py-2 text-sm font-medium"
        data-testid="optimization-plan-not-applied"
      >
        {NOT_APPLIED_BANNER}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Ranks the findings the usage, detached-parts, merge-cost and schema
          advisors already stored. No system table is scanned and nothing is
          applied.
        </p>
        <Button
          onClick={() => (requested ? refetch() : setRequested(true))}
          disabled={isFetching}
        >
          {isFetching ? 'Building…' : requested ? 'Rebuild' : 'Build plan'}
        </Button>
      </div>

      {!requested ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-10">
          <EmptyState
            variant="no-data"
            title="No plan yet"
            description="Build a plan to rank the stored advisor findings by savings, cost and risk."
          />
        </div>
      ) : isLoading ? (
        <TableSkeleton rows={4} />
      ) : error ? (
        <ChartError
          error={error as Error}
          title="Optimization plan"
          onRetry={() => refetch()}
        />
      ) : data?.unavailable ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-10">
          <EmptyState
            variant="no-data"
            title="Plan unavailable"
            description={data.unavailable.message}
          />
        </div>
      ) : data?.plan ? (
        <PlanView plan={data.plan} />
      ) : null}
    </div>
  )
}

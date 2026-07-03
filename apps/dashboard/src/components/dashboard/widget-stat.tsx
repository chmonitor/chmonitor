/**
 * widget-stat — single-stat display. Runs `props.statQuery` (a raw SQL
 * SELECT) through the same ad-hoc query endpoint the Explorer page uses
 * (`/api/v1/explorer/query` — read-only-enforced, auth-gated the same way
 * for anon/write-restricted deployments), and renders the first numeric
 * value in the first row, large, with `props.statLabel` underneath.
 *
 * Deliberately simple (V1): no chart, no historical comparison, no custom
 * formatting — just a number. Errors (including "not authorized" for an
 * anonymous shared-dashboard viewer) degrade to a graceful empty state
 * rather than crashing the widget.
 */

import { useQuery } from '@tanstack/react-query'

import type { DashboardWidget } from '@/types/dashboard-layout'

import { Skeleton } from '@/components/ui/skeleton'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

interface StatQueryResponse {
  success: boolean
  data?: Record<string, unknown>[]
  error?: { message?: string }
}

function useStatQuery(sql: string | undefined, hostId: number) {
  return useQuery({
    queryKey: ['dashboard-widget-stat', sql, hostId],
    queryFn: async () => {
      const params = new URLSearchParams({
        sql: sql ?? '',
        hostId: String(hostId),
        format: 'JSONEachRow',
      })
      const res = await apiFetch(`/api/v1/explorer/query?${params.toString()}`)
      const body = (await res.json().catch(() => ({}))) as StatQueryResponse
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message ?? `Query failed (${res.status})`)
      }
      return body.data ?? []
    },
    enabled: Boolean(sql),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** First numeric-looking value in the row, formatted for large display. */
function firstNumericValue(
  row: Record<string, unknown> | undefined
): string | null {
  if (!row) return null
  for (const value of Object.values(row)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Intl.NumberFormat('en-US').format(value)
    }
    if (
      typeof value === 'string' &&
      value.trim() !== '' &&
      !Number.isNaN(Number(value))
    ) {
      return new Intl.NumberFormat('en-US').format(Number(value))
    }
  }
  const first = Object.values(row)[0]
  return first === undefined || first === null ? null : String(first)
}

export function WidgetStat({ widget }: { widget: DashboardWidget }) {
  const hostId = useHostId()
  const statQuery =
    typeof widget.props?.statQuery === 'string'
      ? widget.props.statQuery
      : undefined
  const statLabel =
    typeof widget.props?.statLabel === 'string'
      ? widget.props.statLabel
      : undefined

  const { data, isLoading, error } = useStatQuery(statQuery, hostId)

  if (!statQuery) {
    return (
      <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
        No query configured for this stat.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <span className="text-xs text-destructive">Failed to load</span>
        <span className="text-[11px] text-muted-foreground">
          {error instanceof Error ? error.message : 'Unknown error'}
        </span>
      </div>
    )
  }

  const value = firstNumericValue(data?.[0])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <span className="text-3xl font-semibold tracking-tight tabular-nums">
        {value ?? '—'}
      </span>
      {statLabel && (
        <span className="text-xs text-muted-foreground">{statLabel}</span>
      )}
    </div>
  )
}

'use client'

/**
 * "Schema & Settings" tab of the `/advisor` page — the auto fine-tune engine's
 * UI. Scans a database (or one table) and renders ranked, recommend-only schema
 * lint + settings tuning findings via `TuningFindingsPanel`. See issue #2764.
 *
 * Recommend-only: everything shown is copyable text to review and run
 * yourself — the panel has no "apply" action.
 */

import { SlidersHorizontalIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useState } from 'react'
import {
  type TuningFindingsOutput,
  TuningFindingsPanel,
} from '@/components/agents/tuning-findings-panel'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

interface TuningApiResponse extends TuningFindingsOutput {
  success: true
}
interface TuningApiError {
  success: false
  error: string
}

const fetcher = async (url: string): Promise<TuningApiResponse> => {
  const res = await apiFetch(url)
  const body = (await res.json()) as TuningApiResponse | TuningApiError
  if (!res.ok || !body.success) {
    throw new Error(
      (body as TuningApiError).error || `Scan failed (HTTP ${res.status})`
    )
  }
  return body
}

export function AdvisorTuningTab() {
  const hostId = useHostId()
  const [databaseInput, setDatabaseInput] = useState('')
  const [tableInput, setTableInput] = useState('')
  const [committed, setCommitted] = useState<{
    database: string
    table: string
  } | null>(null)

  const apiUrl = committed
    ? (() => {
        const params = new URLSearchParams()
        params.set('hostId', String(hostId))
        params.set('database', committed.database)
        if (committed.table) params.set('table', committed.table)
        return `/api/v1/advisor/tuning?${params.toString()}`
      })()
    : null

  const { data, error, isLoading, isFetching } = useQuery<TuningApiResponse>({
    queryKey: [apiUrl],
    queryFn: () => fetcher(apiUrl as string),
    enabled: Boolean(apiUrl),
  })

  const handleScan = () => {
    if (!databaseInput.trim()) return
    setCommitted({
      database: databaseInput.trim(),
      table: tableInput.trim(),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-muted-foreground">
            Scan a database for ranked schema lint findings (needless Nullable,
            oversized integers, compression-codec opportunities, LowCardinality
            candidates) and settings that differ from defaults in risky ways.
            Every suggestion is copyable text to review and run yourself —
            nothing here is ever applied automatically. Findings that depend on
            data (null counts, integer ranges, distinct ratios) include a
            verification query to confirm first.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tuning-database" className="text-xs">
                Database (required)
              </Label>
              <Input
                id="tuning-database"
                value={databaseInput}
                onChange={(e) => setDatabaseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleScan()
                }}
                placeholder="e.g. default"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tuning-table" className="text-xs">
                Table (optional — scans the whole database if empty)
              </Label>
              <Input
                id="tuning-table"
                value={tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleScan()
                }}
                placeholder="e.g. events"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleScan} disabled={!databaseInput.trim()}>
              <SlidersHorizontalIcon className="size-4" />
              Scan
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading || (isFetching && !data) ? <TableSkeleton rows={4} /> : null}

      {error ? (
        <ErrorAlert
          title="Scan failed"
          message={error instanceof Error ? error.message : String(error)}
        />
      ) : null}

      {!isLoading && !error && data ? (
        data.findings.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <EmptyState
                variant="no-data"
                title="No tuning opportunities"
                description="The scanned columns and changed settings look well-tuned — no schema lint or settings findings were raised."
              />
            </CardContent>
          </Card>
        ) : (
          <TuningFindingsPanel output={data} />
        )
      ) : null}
    </div>
  )
}

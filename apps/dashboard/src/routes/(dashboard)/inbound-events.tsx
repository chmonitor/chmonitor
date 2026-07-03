/**
 * Inbound Events Page
 * Route: /(dashboard)/inbound-events
 *
 * Lists normalized inbound events (Alertmanager, Datadog, generic webhook)
 * ingested via POST /api/events/ingest, with source/severity filters. Reads
 * GET /api/events. See lib/events/ and plans/36-inbound-event-bus-queues.md.
 */

import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/swr/api-fetch'

// ── Types matching GET /api/events response ──────────────────────────────────

type EventSource = 'alertmanager' | 'datadog' | 'generic'
type EventSeverity = 'critical' | 'warning' | 'info'

interface StoredEventDto {
  id: string
  source: EventSource
  severity: EventSeverity
  resource: string
  title: string
  body: string | null
  labels: Record<string, string>
  receivedAt: number
  dedupHash: string
  count: number
  lastSeen: number
}

interface EventsResponse {
  success: boolean
  data: StoredEventDto[]
}

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchEvents(): Promise<EventsResponse> {
  const res = await apiFetch('/api/events')
  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})`)
  }
  return res.json()
}

const SEVERITY_BADGE_CLASS: Record<EventSeverity, string> = {
  critical: 'border-destructive/40 text-destructive',
  warning:
    'border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400',
  info: 'border-border text-muted-foreground',
}

// ── Page component ────────────────────────────────────────────────────────────

function InboundEventsPage() {
  const [source, setSource] = useState('all')
  const [severity, setSeverity] = useState('all')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['inbound-events'],
    queryFn: fetchEvents,
    staleTime: 30_000,
  })

  const events = data?.data ?? []

  const filtered = useMemo(
    () =>
      events.filter((event) => {
        if (source !== 'all' && event.source !== source) return false
        if (severity !== 'all' && event.severity !== severity) return false
        return true
      }),
    [events, source, severity]
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inbound Events"
        description="Alertmanager, Datadog, and generic webhook events ingested via POST /api/events/ingest"
      />

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-8 w-full sm:w-44">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="alertmanager">Alertmanager</SelectItem>
            <SelectItem value="datadog">Datadog</SelectItem>
            <SelectItem value="generic">Generic</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="h-8 w-full sm:w-44">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading events…
            </div>
          ) : error ? (
            <div className="p-6">
              <p className="text-sm text-destructive">
                {error instanceof Error
                  ? error.message
                  : 'Failed to load events'}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              variant={events.length === 0 ? 'no-data' : 'filtered-empty'}
              title={
                events.length === 0
                  ? 'No inbound events yet'
                  : 'No events match the current filters'
              }
              description={
                events.length === 0
                  ? 'Configure an Alertmanager, Datadog, or generic webhook to POST to /api/events/ingest to see events here.'
                  : 'Try a different source or severity filter.'
              }
              onRefresh={() => refetch()}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Severity</TableHead>
                    <TableHead className="w-28">Source</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead className="w-20 text-right">Count</TableHead>
                    <TableHead className="w-40">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((event) => (
                    <TableRow key={event.dedupHash}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={SEVERITY_BADGE_CLASS[event.severity]}
                        >
                          {event.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {event.source}
                      </TableCell>
                      <TableCell className="text-sm">{event.title}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {event.resource}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {event.count}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(event.lastSeen).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {filtered.length.toLocaleString()} event
        {filtered.length !== 1 ? 's' : ''}
        {filtered.length !== events.length &&
          ` (filtered from ${events.length.toLocaleString()})`}
      </p>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/inbound-events')({
  component: InboundEventsPage,
})

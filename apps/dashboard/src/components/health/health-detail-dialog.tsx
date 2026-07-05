import { ExternalLink, Sparkles } from 'lucide-react'

import type { AuditPromptInput } from '@/lib/health/audit-prompt'
import type { HealthCheckDef } from './health-checks'

import { HealthAuditPromptDialog } from './health-audit-prompt-dialog'
import { HealthDetailRows } from './health-detail-rows'
import { useState } from 'react'
import { AppLink } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface HealthDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  check: HealthCheckDef
  hostId: number
  status: 'ok' | 'warning' | 'critical' | 'error' | 'loading'
  value: number | null
  label: string
  thresholds: { warning: number; critical: number }
  row?: Record<string, unknown>
  clickhouseVersion?: string
}

function StatusBadge({
  status,
}: {
  status: HealthDetailDialogProps['status']
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'capitalize',
        status === 'critical' && 'bg-red-500/15 text-red-700 dark:text-red-300',
        status === 'warning' &&
          'bg-amber-500/15 text-amber-700 dark:text-amber-300',
        status === 'ok' && 'bg-green-500/15 text-green-700 dark:text-green-300',
        status === 'error' && 'bg-muted text-muted-foreground'
      )}
    >
      {status}
    </Badge>
  )
}

export function HealthDetailDialog({
  open,
  onOpenChange,
  check,
  hostId,
  status,
  value,
  label,
  thresholds,
  row,
  clickhouseVersion,
}: HealthDetailDialogProps) {
  const [promptOpen, setPromptOpen] = useState(false)

  const promptInput: AuditPromptInput = {
    check,
    value,
    thresholds,
    status,
    row,
    hostId,
    clickhouseVersion,
  }

  const displayValue = check.formatValue
    ? check.formatValue(value)
    : value !== null
      ? value.toLocaleString()
      : '—'

  const withHost = (href: string) =>
    `${href}${href.includes('?') ? '&' : '?'}host=${hostId}`

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn('max-w-3xl', check.detailChartName && 'sm:max-w-5xl')}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{check.title}</DialogTitle>
              <StatusBadge status={status} />
            </div>
            {check.description && (
              <DialogDescription>{check.description}</DialogDescription>
            )}
          </DialogHeader>

          <ScrollArea className="min-w-0 max-h-[60vh] pr-3">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    Current value
                  </div>
                  <div className="text-xl font-bold tabular-nums">
                    {displayValue}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {label}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Warning ≥</div>
                  <div className="text-xl font-bold tabular-nums">
                    {thresholds.warning.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    Critical ≥
                  </div>
                  <div className="text-xl font-bold tabular-nums">
                    {thresholds.critical.toLocaleString()}
                  </div>
                </div>
              </div>

              {check.detailChartName && (
                <>
                  <Separator />
                  <HealthDetailRows
                    chartName={check.detailChartName}
                    hostId={hostId}
                    title={check.detailTitle ?? 'Affected rows'}
                    description={check.detailDescription}
                    emptyMessage={check.detailEmptyMessage}
                  />
                </>
              )}

              {!check.detailChartName && row && Object.keys(row).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Raw data</h4>
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {Object.entries(row).map(([k, v]) => (
                            <tr key={k} className="border-t first:border-t-0">
                              <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                {k}
                              </td>
                              <td className="px-3 py-1.5 font-mono tabular-nums break-all">
                                {v === null || v === undefined
                                  ? '—'
                                  : typeof v === 'object'
                                    ? JSON.stringify(v)
                                    : String(v)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {check.sql && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2">SQL query</h4>
                    <pre className="rounded-md border bg-muted/40 p-3 overflow-x-auto text-xs font-mono leading-relaxed">
                      <code>{check.sql}</code>
                    </pre>
                  </div>
                </>
              )}

              {check.commonCauses && check.commonCauses.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2">
                      Common causes
                    </h4>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {check.commonCauses.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {check.systemTables && check.systemTables.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2">
                      Relevant system tables
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {check.systemTables.map((t) => (
                        <Badge key={t} variant="outline" className="font-mono">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {check.relatedLinks && check.relatedLinks.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2">
                      Related pages
                    </h4>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      {check.relatedLinks.map((l) => (
                        <AppLink
                          key={l.href}
                          href={withHost(l.href)}
                          className="text-primary hover:underline"
                        >
                          {l.label}
                        </AppLink>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {check.docsLinks && check.docsLinks.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2">
                      Documentation
                    </h4>
                    <ul className="space-y-1 text-sm">
                      {check.docsLinks.map((d) => (
                        <li key={d.url}>
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {d.label}
                            <ExternalLink className="size-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => setPromptOpen(true)}>
              <Sparkles className="mr-2 size-4" />
              Generate audit prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HealthAuditPromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        title={check.title}
        input={promptInput}
      />
    </>
  )
}

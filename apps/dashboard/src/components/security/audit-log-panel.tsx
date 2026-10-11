/**
 * Audit-log panel for the RBAC management page.
 *
 * Lists the operations executed in this browser session. `AuditLogPanel` takes
 * a `revision` prop that changes whenever the page records a new entry, forcing
 * a re-render of the wrapper (matching the original page behaviour).
 */

import { useAuditLogEntries } from './use-audit-log'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

function AuditLogSection() {
  const { entries, clear } = useAuditLogEntries()

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Log</CardTitle>
          <CardDescription>
            Operations executed in this browser session are recorded here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState compact title="No entries yet" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Audit Log</CardTitle>
          <CardDescription>
            Last {entries.length} operation{entries.length !== 1 ? 's' : ''}{' '}
            executed in this browser.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Time</th>
                <th className="pb-2 pr-4 font-medium">Operation</th>
                <th className="pb-2 pr-4 font-medium">Host</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">DDL / Error</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2 pr-4 font-mono">{e.operation}</td>
                  <td className="py-2 pr-4">{e.hostId}</td>
                  <td className="py-2 pr-4">
                    {e.success ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400"
                      >
                        OK
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Error</Badge>
                    )}
                  </td>
                  <td className="py-2">
                    <code className="break-all font-mono text-xs">
                      {e.success ? e.ddl : (e.error ?? e.ddl)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

// Wrapper that re-renders AuditLogSection when a new entry is appended from
// outside its own state (via the changing `revision`).
export function AuditLogPanel({ revision }: { revision: number }) {
  // revision changes whenever the parent records an audit entry — triggers
  // re-render
  void revision
  return <AuditLogSection />
}

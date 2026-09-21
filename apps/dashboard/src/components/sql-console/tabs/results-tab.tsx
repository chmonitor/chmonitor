import { AlertCircle, ShieldAlert } from 'lucide-react'

import type { SqlRunError, SqlRunResult } from '../hooks/use-sql-runner'

import { ResultTable } from '../result-table'
import { TableSkeleton } from '@/components/skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export function ResultsTab({
  result,
  error,
  isRunning,
  hasRun,
}: {
  result: SqlRunResult | null
  error: SqlRunError | null
  isRunning: boolean
  hasRun: boolean
}) {
  if (isRunning && !result) return <TableSkeleton />

  if (error) {
    const isPermission = error.type === 'permission_error'
    const Icon = isPermission ? ShieldAlert : AlertCircle
    return (
      <Alert
        variant="destructive"
        className={cn(isPermission && 'border-amber-500/50 bg-amber-500/10')}
      >
        <Icon className="size-4" />
        <AlertTitle>
          {isPermission ? 'Permission Denied' : 'Query failed'}
        </AlertTitle>
        <AlertDescription className="mt-1 font-mono text-xs whitespace-pre-wrap">
          {error.message}
        </AlertDescription>
      </Alert>
    )
  }

  if (!hasRun) {
    return (
      <div className="text-muted-foreground p-8 text-center text-sm">
        Write a query and press{' '}
        <kbd className="bg-muted rounded border px-1.5 py-0.5 text-xs text-foreground">
          ⌘/Ctrl + Enter
        </kbd>{' '}
        to run.
      </div>
    )
  }

  return <ResultTable rows={result?.rows ?? []} />
}

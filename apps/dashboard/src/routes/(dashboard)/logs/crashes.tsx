import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { LogFilters } from '@/components/logs/log-filters'
import { PageSkeleton } from '@/components/skeletons'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { crashLogConfig } from '@/lib/query-config/logs/crashes'

function CrashesContent() {
  const searchParams = useUrlSearchParams()
  const severity = searchParams.get('severity') ?? undefined
  const search = searchParams.get('search') ?? undefined

  const extraParams: Record<string, string> = {}
  if (severity) extraParams.severity = severity
  if (search) extraParams.search = search

  return (
    <div className="flex flex-col gap-3">
      {/* Log-level filter bar — for crash logs this filters by signal type.
          The GitHub Issues link in each row lets users look up the version. */}
      <LogFilters />
      <PageLayout
        queryConfig={crashLogConfig}
        title="Crash Log"
        searchParams={
          Object.keys(extraParams).length > 0 ? extraParams : undefined
        }
        footerContent={
          <p className="text-xs text-muted-foreground">
            Tip: click a version in the table, then search{' '}
            <a
              href="https://github.com/ClickHouse/ClickHouse/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              ClickHouse issues
            </a>{' '}
            for known crash reports matching that version.
          </p>
        }
      />
    </div>
  )
}

function CrashesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CrashesContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/logs/crashes')({
  component: CrashesPage,
})

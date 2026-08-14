import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { LogFilters } from '@/components/logs/log-filters'
import { PageSkeleton } from '@/components/skeletons'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { textLogConfig } from '@/lib/query-config/logs/text-log'

function TextLogContent() {
  const searchParams = useUrlSearchParams()
  const severity = searchParams.get('severity') ?? undefined
  const search = searchParams.get('search') ?? undefined

  // Build extra search params to pass to the API so the server can use them
  // to narrow the result set (the text_log query config supports level filtering
  // via filterParamPresets; severity + search are passed as additional params
  // for forward-compatibility with server-side filtering).
  const extraParams: Record<string, string> = {}
  if (severity) extraParams.severity = severity
  if (search) extraParams.search = search

  return (
    <div className="flex flex-col gap-3">
      <LogFilters />
      <PageLayout
        queryConfig={textLogConfig}
        title="Server Text Log"
        searchParams={
          Object.keys(extraParams).length > 0 ? extraParams : undefined
        }
      />
    </div>
  )
}

function TextLogPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TextLogContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/logs/text-log')({
  component: TextLogPage,
})

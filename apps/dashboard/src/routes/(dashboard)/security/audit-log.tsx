import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { sessionsConfig } from '@/lib/query-config/security/sessions'

function AuditLogContent() {
  return <PageLayout queryConfig={sessionsConfig} title="Audit Log" />
}

function AuditLogPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditLogContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/security/audit-log')({
  component: AuditLogPage,
  head: () => pageOgHead('security/audit-log'),
})

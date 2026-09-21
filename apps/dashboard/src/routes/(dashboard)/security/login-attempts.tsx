import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { loginAttemptsConfig } from '@/lib/query-config/security/login-attempts'

function LoginAttemptsContent() {
  return <PageLayout queryConfig={loginAttemptsConfig} title="Login Attempts" />
}

function LoginAttemptsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LoginAttemptsContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/security/login-attempts')({
  component: LoginAttemptsPage,
  head: () => pageOgHead('security/login-attempts'),
})

import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageSkeleton } from '@/components/skeletons'
import { UsersPage } from '@/components/users/users-page'
import { pageOgHead } from '@/lib/og'

function UsersRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsersPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/users')({
  component: UsersRoute,
  head: () => pageOgHead('users'),
})

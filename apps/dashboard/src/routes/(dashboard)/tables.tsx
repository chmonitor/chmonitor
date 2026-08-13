import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useEffect } from 'react'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { splitHref } from '@/lib/url/url-builder'

function TablesPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate(splitHref('/table?database=default'))
  }, [navigate])

  return <PageSkeleton />
}

export const Route = createFileRoute('/(dashboard)/tables')({
  component: TablesPage,
  head: () => pageOgHead('tables'),
})

import { createFileRoute } from '@tanstack/react-router'

import { UserProcessesView } from '@/components/user-processes'
import { pageOgHead } from '@/lib/og'

function UserProcessesPage() {
  return <UserProcessesView />
}

export const Route = createFileRoute('/(dashboard)/user-processes')({
  component: UserProcessesPage,
  head: () => pageOgHead('user-processes'),
})

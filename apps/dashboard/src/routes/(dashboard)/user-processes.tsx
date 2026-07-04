import { createFileRoute } from '@tanstack/react-router'

import { UserProcessesView } from '@/components/user-processes'

function UserProcessesPage() {
  return <UserProcessesView />
}

export const Route = createFileRoute('/(dashboard)/user-processes')({
  component: UserProcessesPage,
})

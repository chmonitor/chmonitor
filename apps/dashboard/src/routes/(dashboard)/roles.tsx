import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { rolesConfig } from '@/lib/query-config/more/roles'

const RolesPage = createPage({
  queryConfig: rolesConfig,
  title: 'Roles',
})

export const Route = createFileRoute('/(dashboard)/roles')({
  component: RolesPage,
  head: () => pageOgHead('roles'),
})

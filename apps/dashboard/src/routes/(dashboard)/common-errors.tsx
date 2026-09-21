import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { commonErrorsConfig } from '@/lib/query-config/queries/common-errors'

const CommonErrorsPage = createPage({
  queryConfig: commonErrorsConfig,
  title: 'Latest Common Errors',
})

export const Route = createFileRoute('/(dashboard)/common-errors')({
  component: CommonErrorsPage,
  head: () => pageOgHead('common-errors'),
})

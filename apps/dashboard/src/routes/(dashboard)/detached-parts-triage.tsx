import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { detachedPartsTriageConfig } from '@/lib/query-config/tables/detached-parts-triage'

const DetachedPartsTriagePage = createPage({
  queryConfig: detachedPartsTriageConfig,
  title: 'Detached Parts Triage',
})

export const Route = createFileRoute('/(dashboard)/detached-parts-triage')({
  component: DetachedPartsTriagePage,
  head: () => pageOgHead('detached-parts-triage'),
})

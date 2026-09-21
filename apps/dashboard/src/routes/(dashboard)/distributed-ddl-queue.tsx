import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { distributedDdlQueueConfig } from '@/lib/query-config/tables/distributed-ddl-queue'

const DistributedDdlQueuePage = createPage({
  queryConfig: distributedDdlQueueConfig,
  title: 'Distributed DDL Queue',
})

export const Route = createFileRoute('/(dashboard)/distributed-ddl-queue')({
  component: DistributedDdlQueuePage,
  head: () => pageOgHead('distributed-ddl-queue'),
})

import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { rabbitmqConsumersConfig } from '@/lib/query-config/system/rabbitmq-consumers'

function RabbitMQConsumersPageContent() {
  return (
    <PageLayout
      queryConfig={rabbitmqConsumersConfig}
      title="RabbitMQ Consumers"
    />
  )
}

function RabbitMQConsumersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RabbitMQConsumersPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/rabbitmq-consumers')({
  component: RabbitMQConsumersPage,
  head: () => pageOgHead('rabbitmq-consumers'),
})

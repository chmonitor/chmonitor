import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { kafkaConsumersConfig } from '@/lib/query-config/system/kafka-consumers'

function KafkaConsumersPageContent() {
  return (
    <PageLayout queryConfig={kafkaConsumersConfig} title="Kafka Consumers" />
  )
}

function KafkaConsumersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KafkaConsumersPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/kafka-consumers')({
  component: KafkaConsumersPage,
  head: () => pageOgHead('kafka-consumers'),
})

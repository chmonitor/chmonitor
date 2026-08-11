import { ActivityIcon, ScrollTextIcon, ShieldAlertIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const logsItems: MenuItem[] = [
  {
    title: 'Logs',
    href: '',
    icon: ScrollTextIcon,
    section: 'others',
    isNew: true,
    permission: { feature: 'logs' },
    items: [
      {
        title: 'Text Log',
        href: '/logs/text-log',
        description: 'Server logs with query context and stack traces',
        icon: ScrollTextIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/text_log',
        tableCheck: 'system.text_log',
      },
      {
        title: 'Stack Traces',
        href: '/logs/stack-traces',
        description: 'Live thread stack traces for debugging',
        icon: ScrollTextIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/stack_trace',
        tableCheck: 'system.stack_trace',
      },
      {
        title: 'Crashes',
        href: '/logs/crashes',
        description: 'Historical crash reports with diagnostics',
        icon: ShieldAlertIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/crash_log',
        tableCheck: 'system.crash_log',
      },
      {
        title: 'OpenTelemetry Spans',
        href: '/opentelemetry-spans',
        description:
          'Distributed query trace waterfall from system.opentelemetry_span_log: spans across replicas and shards',
        icon: ActivityIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/opentelemetry_span_log',
        tableCheck: 'system.opentelemetry_span_log',
      },
    ],
  },
]

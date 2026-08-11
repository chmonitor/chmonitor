import { RssIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const inboundEventsItems: MenuItem[] = [
  {
    title: 'Inbound Events',
    href: '/inbound-events',
    description:
      'Alertmanager, Datadog, and generic webhook events ingested via POST /api/events/ingest',
    icon: RssIcon,
    section: 'others',
    isNew: true,
    permission: { feature: 'health' },
  },
]

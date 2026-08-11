import { ArchiveIcon, BarChartIcon, DashboardIcon } from '@radix-ui/react-icons'
import { CloudIcon, ShieldAlertIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

import { EVENTS_TABLE } from '@/lib/app-tables'

export const operationsItems: MenuItem[] = [
  {
    title: 'Operations',
    href: '',
    icon: ArchiveIcon,
    section: 'others',
    permission: { feature: 'operations' },
    items: [
      {
        title: 'Chart Builder',
        href: '/dashboard',
        description: 'Build custom monitoring dashboards with charts',
        icon: DashboardIcon,
        permission: { feature: 'dashboard' },
      },
      {
        title: 'Backups',
        href: '/backups',
        description: 'Backup operation history with status and sizes',
        countKey: 'backups',
        countLabel: 'backups',
        icon: ArchiveIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/backup_log',
        tableCheck: 'system.backup_log',
      },
      {
        title: 'Blob Storage Log',
        href: '/blob-storage-log',
        description:
          'Object storage I/O operations (reads, writes, deletes) on S3/blob disks',
        icon: CloudIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/blob_storage_log',
        tableCheck: 'system.blob_storage_log',
      },
      {
        title: 'Errors',
        href: '/errors',
        description: 'Detailed error events with stack traces',
        icon: ShieldAlertIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/error_log',
        tableCheck: 'system.error_log',
      },
      {
        title: 'Page Views',
        href: '/page-views',
        description: 'Dashboard usage analytics',
        countKey: 'page-views',
        countLabel: 'views',
        icon: BarChartIcon,
        tableCheck: EVENTS_TABLE,
      },
    ],
  },
]

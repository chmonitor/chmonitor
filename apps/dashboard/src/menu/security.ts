import { KeyIcon, ShieldAlertIcon, ShieldIcon, UsersIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const securityItems: MenuItem[] = [
  {
    title: 'Security',
    href: '',
    icon: ShieldIcon,
    section: 'others',
    isNew: true,
    permission: { feature: 'security' },
    items: [
      {
        title: 'Sessions',
        href: '/security/sessions',
        description: 'User session history with authentication details',
        icon: UsersIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/session_log',
        tableCheck: 'system.session_log',
      },
      {
        title: 'Login Attempts',
        href: '/security/login-attempts',
        description: 'Authentication events with failure reasons',
        icon: KeyIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/session_log',
        tableCheck: 'system.session_log',
      },
      {
        title: 'Audit Log',
        href: '/security/audit-log',
        description: 'Security-related events and access control',
        icon: ShieldIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/opentelemetry_event_log',
        tableCheck: 'system.session_log',
      },
      {
        title: 'Users',
        href: '/users',
        description:
          'ClickHouse user accounts, authentication types, hosts, and default roles',
        icon: UsersIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/users',
        tableCheck: 'system.users',
      },
      {
        title: 'Roles',
        href: '/roles',
        description: 'Defined roles for role-based access control',
        icon: KeyIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/roles',
        tableCheck: 'system.roles',
      },
      {
        title: 'RBAC Management',
        href: '/security/management',
        description:
          'Create/alter/drop users, grant/revoke roles and privileges (requires CLICKHOUSE_MANAGEMENT_ENABLED)',
        icon: ShieldAlertIcon,
        isNew: true,
      },
    ],
  },
]

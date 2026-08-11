import { InfoCircledIcon } from '@radix-ui/react-icons'

import type { MenuItem } from '@/components/menu/types'

export const aboutItems: MenuItem[] = [
  {
    // Dashboard + server version info. Rendered as a compact footer row (see
    // AppSidebar), not inside a labelled body group. Reachable in both editions
    // — no `cloudOnly` — and with zero hosts configured (exempt from the
    // first-run /setup redirect, see first-run-gate.tsx).
    title: 'About',
    href: '/about',
    description: 'Dashboard and server version information',
    icon: InfoCircledIcon,
    section: 'footer',
    permission: { feature: 'about' },
    engines: ['clickhouse', 'clickhouse-cloud', 'postgres'],
  },
]

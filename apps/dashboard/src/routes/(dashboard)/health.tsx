import { Settings } from 'lucide-react'
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Suspense } from 'react'
import { HealthGrid } from '@/components/health/health-grid'
import { PageHeader } from '@/components/layout'
import { ChartsOnlyPageSkeleton } from '@/components/skeletons'
import { AppLink } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

function HealthPageContent() {
  const hostId = useHostId()
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        title="Health Summary"
        description="Real-time health indicators for your ClickHouse cluster"
        actions={
          <Button
            variant="outline"
            size="sm"
            render={
              <AppLink href={buildUrl('/health-settings', { host: hostId })} />
            }
          >
            <Settings className="mr-2 size-4" />
            Settings
          </Button>
        }
      />
      <HealthGrid />
    </div>
  )
}

function HealthPage() {
  return (
    <Suspense fallback={<ChartsOnlyPageSkeleton chartCount={8} />}>
      <HealthPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/health')({
  component: HealthPage,
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ search }) => {
    // Legacy deep link: /health?settings=alerts used to open the settings
    // dialog — the settings now live on their own page. Use `href` (not `to`)
    // so we don't have to satisfy the route's typed search params, and carry
    // the host param across.
    const s = search as { settings?: string; host?: string | number }
    if (s.settings === 'alerts') {
      throw redirect({ href: buildUrl('/alert-settings', { host: s.host }) })
    }
  },
})

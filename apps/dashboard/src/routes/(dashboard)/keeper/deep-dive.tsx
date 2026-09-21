import { InfoIcon } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useServerVersion } from '@/lib/hooks/use-server-version'
import { pageOgHead } from '@/lib/og'
import {
  keeperChangelogsConfig,
  keeperClusterConfig,
  keeperSnapshotsConfig,
} from '@/lib/query-config/keeper'
import { compareVersions } from '@/lib/server-version'
import { useHostId } from '@/lib/swr/use-host'

const MIN_VERSION = '26.6'

function VersionNotice({ version }: { version: string }) {
  if (!version || compareVersions(version, MIN_VERSION) >= 0) return null
  return (
    <Alert>
      <InfoIcon className="h-4 w-4" />
      <AlertTitle>ClickHouse {MIN_VERSION}+ required</AlertTitle>
      <AlertDescription>
        This host is running ClickHouse {version}. The tables below
        (keeper_snapshots, keeper_changelogs, keeper_cluster) require ClickHouse{' '}
        {MIN_VERSION} or later. They will show as unavailable until the cluster
        is upgraded.
      </AlertDescription>
    </Alert>
  )
}

function KeeperDeepDiveContent() {
  const hostId = useHostId()
  const { data: version = '' } = useServerVersion(hostId)

  return (
    <div className="flex flex-col gap-4">
      <VersionNotice version={version} />
      <PageLayout
        queryConfig={keeperClusterConfig}
        title="Keeper Cluster (Raft Membership)"
      />
      <PageLayout
        queryConfig={keeperSnapshotsConfig}
        title="Keeper Snapshots"
      />
      <PageLayout
        queryConfig={keeperChangelogsConfig}
        title="Keeper Changelogs (WAL)"
      />
    </div>
  )
}

function KeeperDeepDivePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperDeepDiveContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/deep-dive')({
  component: KeeperDeepDivePage,
  head: () => pageOgHead('keeper/deep-dive'),
})

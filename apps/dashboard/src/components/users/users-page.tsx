import { PageLayout } from '@/components/layout/query-page'
import { useIsTableAvailable } from '@/components/menu/hooks/use-table-availability'
import { PageSkeleton } from '@/components/skeletons'
import { UserLinkGroup } from '@/components/users/user-link-group'
import { buildUsersRelatedLinks } from '@/components/users/user-links'
import { pickUsersConfig } from '@/lib/query-config/more/users'
import { useHostId } from '@/lib/swr'

/**
 * `/users`: picks the list variant for the log tables this host has, so a
 * missing query or session log hides its columns instead of failing the page.
 */
export function UsersPage() {
  const hostId = useHostId()
  const queryLog = useIsTableAvailable('system.query_log', hostId)
  const sessionLog = useIsTableAvailable('system.session_log', hostId)

  if (queryLog.isLoading || sessionLog.isLoading) return <PageSkeleton />

  const queryConfig = pickUsersConfig({
    activity: queryLog.available,
    login: sessionLog.available,
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <UserLinkGroup label="Related" links={buildUsersRelatedLinks(hostId)} />
      <PageLayout
        key={queryConfig.name}
        queryConfig={queryConfig}
        title="Users"
      />
    </div>
  )
}

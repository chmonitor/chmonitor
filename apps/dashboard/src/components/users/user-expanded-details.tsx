import type { ReactNode } from 'react'

import { FleetSparkline } from '@/components/fleet/fleet-sparkline'
import { useIsTableAvailable } from '@/components/menu/hooks/use-table-availability'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { splitList } from '@/components/usage/user-usage-header'
import { UserLinkGroup } from '@/components/users/user-link-group'
import { buildUserLinks } from '@/components/users/user-links'
import { EXPIRY_TONES, STATUS_TONES } from '@/components/users/user-status'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { resolveFeatureState } from '@/lib/feature-permissions/shared'
import { useTableData } from '@/lib/query/use-table-data'
import {
  userDetailHourlyConfig,
  userDetailLoginConfig,
  userDetailRecentConfig,
  userDetailSummaryConfig,
} from '@/lib/query-config/more/user-detail'
import {
  userUsageKindsConfig,
  userUsageProfileConfig,
} from '@/lib/query-config/queries/user-usage'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

/**
 * Expanded row on `/users`: one user's last 7 days, latest queries, last
 * login, roles and links. Every fetch is keyed on this one user and runs only
 * while the row is open. Query-log sections follow the `queries` feature gate,
 * the login and roles sections the `security` gate.
 */

interface SummaryRow {
  queries: number
  errors: number
  readable_read_bytes: string
  readable_memory_p95: string
}

interface RecentRow {
  event_time: string
  query_duration_ms: number
  status: string
  kind: string
  query_shape: string
}

interface HourRow {
  hour: string
  queries: number
}

interface KindRow {
  kind: string
  queries: number
  pct_queries: number
}

interface LoginRow {
  last_login: string
  client_address: string
  interface: string
}

interface ProfileRow {
  default_roles_all: number
  default_roles: string
  granted_roles: string
  profiles: string
}

const QUERIES_PERMISSION = { feature: 'queries' } as const
const SECURITY_PERMISSION = { feature: 'security' } as const

function Section({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-2', className)}>
      <h4 className="text-[10px] max-sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2">
      <div className="truncate text-[10px] max-sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums">
        {value}
      </div>
    </div>
  )
}

function ToneBadge({
  value,
  tones,
}: {
  value: string
  tones: Record<string, string>
}) {
  return (
    <Badge variant="outline" className={cn('border-transparent', tones[value])}>
      {value}
    </Badge>
  )
}

function ActivitySection({ user }: { user: string }) {
  const hostId = useHostId()
  const summary = useTableData<SummaryRow>(
    userDetailSummaryConfig.name,
    hostId,
    {
      user,
    }
  )
  const hourly = useTableData<HourRow>(userDetailHourlyConfig.name, hostId, {
    user,
  })
  const kinds = useTableData<KindRow>(userUsageKindsConfig.name, hostId, {
    user,
    days: '7',
  })
  const row = summary.data?.[0]
  const hours = (hourly.data ?? []).map((h) => Number(h.queries))
  const kindRows = (kinds.data ?? []).slice(0, 6)

  return (
    <>
      <Section title="Last 7 days">
        {row ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Queries"
              value={Number(row.queries).toLocaleString()}
            />
            <Tile label="Errors" value={Number(row.errors).toLocaleString()} />
            <Tile label="Read" value={row.readable_read_bytes} />
            <Tile label="Memory p95" value={row.readable_memory_p95} />
          </div>
        ) : summary.isLoading ? (
          <Skeleton className="h-[52px] rounded-md" />
        ) : (
          <p className="text-xs text-muted-foreground">No activity data.</p>
        )}
      </Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Queries per hour, last 24h">
          {hours.some((n) => n > 0) ? (
            <FleetSparkline
              values={hours}
              label={`Queries per hour for ${user}, last 24 hours`}
              className="h-10"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No queries in the last 24 hours.
            </p>
          )}
        </Section>
        <Section title="Query kinds, last 7 days">
          {kindRows.length ? (
            <ul className="flex flex-col gap-1 text-xs">
              {kindRows.map((k) => (
                <li
                  key={k.kind}
                  className="relative flex justify-between gap-2 rounded px-1.5 py-0.5"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 rounded bg-chart-1/15"
                    style={{ width: `${Number(k.pct_queries) || 0}%` }}
                  />
                  <span className="relative truncate">{k.kind}</span>
                  <span className="relative tabular-nums">
                    {Number(k.queries).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No queries.</p>
          )}
        </Section>
      </div>
    </>
  )
}

function RecentSection({ user }: { user: string }) {
  const hostId = useHostId()
  const { data, isLoading } = useTableData<RecentRow>(
    userDetailRecentConfig.name,
    hostId,
    { user }
  )
  const rows = data ?? []

  return (
    <Section title="Latest queries (literals replaced)">
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-border/60 text-xs">
          {rows.map((r, i) => (
            <li
              key={`${r.event_time}-${i}`}
              className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.event_time}
              </span>
              <code
                className="min-w-0 flex-1 truncate font-mono"
                title={r.query_shape}
              >
                {r.query_shape}
              </code>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {Number(r.query_duration_ms).toLocaleString()} ms
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'shrink-0',
                  r.status === 'QueryFinish'
                    ? 'text-muted-foreground'
                    : 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                )}
              >
                {r.status === 'QueryFinish' ? 'ok' : 'failed'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : isLoading ? (
        <Skeleton className="h-16 rounded-md" />
      ) : (
        <p className="text-xs text-muted-foreground">
          No queries in the last 7 days.
        </p>
      )}
    </Section>
  )
}

function LoginSection({ user }: { user: string }) {
  const hostId = useHostId()
  const { available, isLoading } = useIsTableAvailable(
    userDetailLoginConfig.tableCheck,
    hostId
  )
  if (isLoading || !available) return null
  return <LoginBody user={user} />
}

function LoginBody({ user }: { user: string }) {
  const hostId = useHostId()
  const { data, isLoading } = useTableData<LoginRow>(
    userDetailLoginConfig.name,
    hostId,
    { user }
  )
  const row = data?.[0]

  return (
    <Section title="Last login, 30 days">
      {row ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            At{' '}
            <span className="text-foreground tabular-nums">
              {row.last_login}
            </span>
          </span>
          <span>
            From{' '}
            <span className="font-mono text-foreground">
              {row.client_address}
            </span>
          </span>
          <span>
            Via <span className="text-foreground">{row.interface}</span>
          </span>
        </p>
      ) : isLoading ? (
        <Skeleton className="h-4 w-48" />
      ) : (
        <Badge variant="outline" className="w-fit text-muted-foreground">
          never logged in (30d)
        </Badge>
      )}
    </Section>
  )
}

function RolesSection({ user }: { user: string }) {
  const hostId = useHostId()
  const { data } = useTableData<ProfileRow>(
    userUsageProfileConfig.name,
    hostId,
    {
      user,
    }
  )
  const row = data?.[0]
  if (!row) return null
  const roles = splitList(row.granted_roles)
  const defaults = row.default_roles_all
    ? 'all granted'
    : splitList(row.default_roles).join(', ') || 'none'
  const rolesHref = `/roles?host=${hostId}`

  return (
    <Section title="Roles">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-1">
          Granted
          {roles.length ? (
            roles.map((r) => (
              <Link key={r} href={rolesHref}>
                <Badge variant="outline" className="hover:text-primary">
                  {r}
                </Badge>
              </Link>
            ))
          ) : (
            <span className="text-foreground">none</span>
          )}
        </span>
        <span>
          Default <span className="text-foreground">{defaults}</span>
        </span>
        <span>
          Profiles{' '}
          <span className="text-foreground">
            {splitList(row.profiles).join(', ') || 'none'}
          </span>
        </span>
      </div>
    </Section>
  )
}

export default function UserExpandedDetails({
  row,
}: {
  row: Record<string, unknown>
}) {
  const hostId = useHostId()
  const { config, isLoading } = useFeaturePermissions()
  const user = String(row.name ?? '')
  if (!user) return null

  const queriesOn =
    !isLoading && resolveFeatureState(QUERIES_PERMISSION, config).enabled
  const securityOn =
    !isLoading && resolveFeatureState(SECURITY_PERMISSION, config).enabled
  const status = typeof row.status === 'string' ? row.status : ''
  const expiry = typeof row.expiry_status === 'string' ? row.expiry_status : ''
  const validUntil = typeof row.valid_until === 'string' ? row.valid_until : ''

  return (
    <div className="sticky left-0 flex min-w-0 max-w-[min(64rem,calc(100vw-2rem))] flex-col gap-4 py-1">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {status ? <ToneBadge value={status} tones={STATUS_TONES} /> : null}
        {expiry ? <ToneBadge value={expiry} tones={EXPIRY_TONES} /> : null}
        {validUntil ? (
          <span>
            Valid until <span className="text-foreground">{validUntil}</span>
          </span>
        ) : null}
      </div>
      {queriesOn && status ? <ActivitySection user={user} /> : null}
      {queriesOn && status ? <RecentSection user={user} /> : null}
      {securityOn ? <LoginSection user={user} /> : null}
      {securityOn ? <RolesSection user={user} /> : null}
      <UserLinkGroup label="Open" links={buildUserLinks(hostId, user)} />
    </div>
  )
}

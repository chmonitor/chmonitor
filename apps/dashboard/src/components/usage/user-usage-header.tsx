import { ChartError } from '@/components/charts/chart-error'
import { Badge } from '@/components/ui/badge'
import { type KpiTile, KpiTiles } from '@/components/usage/kpi-tiles'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { resolveFeatureState } from '@/lib/feature-permissions/shared'
import { formatCompactNumber } from '@/lib/format-readable'
import { useTableData } from '@/lib/query/use-table-data'
import {
  userUsageProfileConfig,
  userUsageSummaryConfig,
} from '@/lib/query-config/queries/user-usage'
import { useHostId } from '@/lib/swr'

export interface UserUsageSummaryRow {
  queries: number
  failed: number
  failed_pct: number | null
  p95_ms: number
  readable_bytes_read: string
  window_days: number
}

export type UserUsageKpi = KpiTile

/** KPI tile values; kept pure so the formatting is unit-tested. */
export function buildUserUsageKpis(row: UserUsageSummaryRow): UserUsageKpi[] {
  const failedPct = Number(row.failed_pct ?? 0)
  return [
    { label: 'Queries', value: formatCompactNumber(Number(row.queries)) },
    {
      label: 'Failed',
      value: `${failedPct.toFixed(failedPct > 0 && failedPct < 1 ? 2 : 1)}%`,
    },
    {
      label: 'p95 duration',
      value: `${Number(row.p95_ms).toLocaleString()} ms`,
    },
    { label: 'Bytes read', value: row.readable_bytes_read },
  ]
}

interface UserUsageProps {
  user: string
  days: string
}

/** Queries, failed %, p95 and bytes read for one user, over the capped window. */
export function UserUsageKpis({ user, days }: UserUsageProps) {
  const hostId = useHostId()
  const { data, error, isLoading, hasData, refresh } =
    useTableData<UserUsageSummaryRow>(userUsageSummaryConfig.name, hostId, {
      user,
      days,
    })

  if (isLoading && !hasData) return <KpiTiles tiles={null} loadingCount={4} />
  const row = data?.[0]
  if (error && !row) {
    return <ChartError error={error} title="Totals" onRetry={() => refresh()} />
  }
  if (!row) return null

  return (
    <div className="flex flex-col gap-1">
      <KpiTiles tiles={buildUserUsageKpis(row)} loadingCount={4} />
      <p className="text-muted-foreground text-xs">
        Last {row.window_days} days, this replica only.
      </p>
    </div>
  )
}

interface UserProfileRow {
  storage: string
  auth_type: string
  default_database: string
  default_roles_all: number
  default_roles: string
  granted_roles: string
  profiles: string
}

/** Split a `', '`-joined list from the profile SQL; empty string gives []. */
export function splitList(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function ProfileBody({ user }: { user: string }) {
  const hostId = useHostId()
  const { data, hasData } = useTableData<UserProfileRow>(
    userUsageProfileConfig.name,
    hostId,
    { user }
  )
  const row = hasData ? data?.[0] : undefined
  if (!row) return null

  const roles = splitList(row.granted_roles)
  const profiles = splitList(row.profiles)
  const defaults = row.default_roles_all
    ? 'all granted'
    : splitList(row.default_roles).join(', ') || 'none'

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span>
        Storage <span className="text-foreground">{row.storage}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        Roles
        {roles.length ? (
          roles.map((r) => (
            <Badge key={r} variant="outline">
              {r}
            </Badge>
          ))
        ) : (
          <span className="text-foreground">none</span>
        )}
      </span>
      <span>
        Default roles <span className="text-foreground">{defaults}</span>
      </span>
      <span>
        Profiles{' '}
        <span className="text-foreground">{profiles.join(', ') || 'none'}</span>
      </span>
      {row.default_database ? (
        <span>
          Default database{' '}
          <span className="text-foreground">{row.default_database}</span>
        </span>
      ) : null}
    </div>
  )
}

/**
 * Roles and profile line under the page title. Shown only when the security
 * feature is enabled (the config is gated on it); a missing or undefined user
 * renders nothing rather than an error.
 */
export function UserUsageProfile({ user }: { user: string }) {
  const { config, isLoading } = useFeaturePermissions()
  if (isLoading) return null
  if (!resolveFeatureState(userUsageProfileConfig.permission, config).enabled)
    return null
  return <ProfileBody user={user} />
}

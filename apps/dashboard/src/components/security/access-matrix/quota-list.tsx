/**
 * Quotas of one grantee in the Access matrix grantee sheet (#4123): the
 * limit of each interval and, for a user, the current usage.
 */

import type { AssignedQuota } from '@/lib/security/access-policies'

import {
  formatDuration,
  limitedMetrics,
  QUOTA_METRICS,
} from '@/lib/security/access-policies'

const fmt = (v: number | string | null | undefined) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString()

const USAGE_NOTE: Record<AssignedQuota['usageKey'], string> = {
  user: "keyed by user name, so usage is this user's own",
  shared: 'not keyed, so usage is shared by everyone it applies to',
  other: 'keyed by IP or client key, so usage cannot be tied to this user',
}

const metricLabel = (k: string) =>
  QUOTA_METRICS.find((m) => m.key === k)?.label ?? k

export function QuotaList({
  quotas,
  isUser,
}: {
  quotas: AssignedQuota[]
  isUser: boolean
}) {
  if (quotas.length === 0)
    return <p className="text-muted-foreground">No quota applies.</p>
  return (
    <div className="space-y-4">
      {quotas.length > 1 && (
        <p className="text-muted-foreground">
          More than one quota applies. ClickHouse tracks a user against one of
          them, so the limits do not add up.
        </p>
      )}
      {quotas.map((q) => {
        const metrics = limitedMetrics(q.limits)
        return (
          <div key={q.name}>
            <p className="mb-1">
              <span className="font-mono">{q.name}</span>
              {isUser && (
                <span className="text-muted-foreground">
                  {' '}
                  ({USAGE_NOTE[q.usageKey]})
                </span>
              )}
            </p>
            {metrics.length === 0 ? (
              <p className="text-muted-foreground">
                No limits, usage is only tracked.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Interval</th>
                    <th className="py-1 pr-2 font-medium">Limit</th>
                    <th className="py-1 pr-2 text-right font-medium">Max</th>
                    {isUser && (
                      <th className="py-1 text-right font-medium">Used</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {q.limits.flatMap((l) => {
                    const used = q.usage.find(
                      (u) => Number(u.duration) === Number(l.duration)
                    )
                    return metrics
                      .filter((k) => l[`max_${k}`] != null)
                      .map((k) => (
                        <tr
                          key={`${l.duration}:${k}`}
                          className="border-t border-border/60"
                        >
                          <td className="py-1 pr-2 font-mono">
                            {formatDuration(l.duration)}
                            {truthyFlag(l.is_randomized_interval)
                              ? ' (randomized)'
                              : ''}
                          </td>
                          <td className="py-1 pr-2">{metricLabel(k)}</td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {fmt(l[`max_${k}`])}
                          </td>
                          {isUser && (
                            <td className="py-1 text-right font-mono">
                              {used ? fmt(used[k]) : '—'}
                            </td>
                          )}
                        </tr>
                      ))
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}

const truthyFlag = (v: number | boolean) => v === true || v === 1

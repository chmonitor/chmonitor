import { Archive } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'

import type { ChartProps } from '@/components/charts/chart-props'

import { memo, useCallback } from 'react'
import { CardMetric } from '@/components/cards/card-metric'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartError } from '@/components/charts/chart-error'
import { ChartSkeleton } from '@/components/skeletons'
import { EmptyState } from '@/components/ui/empty-state'
import { useChartData, useHostId } from '@/lib/swr'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { splitHref } from '@/lib/url/url-builder'

type BackupSizeRow = {
  total_size: number
  uncompressed_size: number
  compressed_size: number
  readable_total_size: string
  readable_uncompressed_size: string
  readable_compressed_size: string
}

export const ChartBackupSize = memo(function ChartBackupSize({
  title,
  interval,
  lastHours,
  className,
  chartCardContentClassName,
  hostId: hostIdProp,
  href,
}: ChartProps) {
  const routeHostId = useHostId()
  const hostId = hostIdProp ?? routeHostId
  const navigate = useNavigate()
  const { data, isLoading, error, mutate, sql, metadata, hasData } =
    useChartData<BackupSizeRow>({
      chartName: 'backup-size',
      hostId,
      interval,
      lastHours,
      refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
    })

  const handleRetry = useCallback(() => {
    mutate()
  }, [mutate])

  if (isLoading) {
    return <ChartSkeleton title={title} type="metric" className={className} />
  }

  if (error && !hasData) {
    return <ChartError error={error} title={title} onRetry={handleRetry} />
  }

  // Empty / table-missing — system.backup_log not present or no rows yet
  if (!data || data.length === 0) {
    return (
      <ChartCard
        title={title}
        className={className}
        contentClassName={chartCardContentClassName}
        sql={sql}
        data={data}
        metadata={metadata}
        data-testid="backup-size-chart"
        href={href}
      >
        <EmptyState
          variant="table-missing"
          icon={
            <Archive
              className="h-10 w-10 text-muted-foreground/60"
              strokeWidth={1.5}
            />
          }
          title="No backup history"
          description={
            <span>
              Backup tracking needs{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">
                system.backup_log
              </code>
              , which isn&apos;t present on this cluster.
            </span>
          }
          action={{
            label: 'Enable backups',
            onClick: () => navigate(splitHref(`/backups?host=${hostId}`)),
          }}
          secondaryAction={{
            label: 'Diagnostics',
            onClick: () => navigate(splitHref(`/backups?host=${hostId}`)),
          }}
        />
      </ChartCard>
    )
  }

  const first = data[0]

  return (
    <ChartCard
      title={title}
      className={className}
      contentClassName={chartCardContentClassName}
      sql={sql}
      data={data}
      metadata={metadata}
      data-testid="backup-size-chart"
      href={href}
    >
      <CardMetric
        current={first.compressed_size}
        currentReadable={`${first.readable_compressed_size} compressed`}
        target={first.uncompressed_size}
        targetReadable={`${first.readable_uncompressed_size} uncompressed`}
        className="p-2"
      />
    </ChartCard>
  )
})

export type ChartBackupSizeProps = ChartProps

export default ChartBackupSize

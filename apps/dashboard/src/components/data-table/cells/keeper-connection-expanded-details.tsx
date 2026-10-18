import {
  ClockIcon,
  DatabaseIcon,
  FingerprintIcon,
  LayersIcon,
  MapPinIcon,
  TimerIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface KeeperConnectionExpandedDetailsProps {
  row: Record<string, unknown>
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value) !== ''
}

function toStringSafe(value: unknown): string {
  return hasValue(value) ? String(value) : ''
}

interface DetailFieldProps {
  label: string
  value: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  mono?: boolean
  className?: string
}

function DetailField({
  label,
  value,
  icon: Icon,
  mono = false,
  className,
}: DetailFieldProps) {
  if (!hasValue(value)) return null

  return (
    <div
      className={cn(
        'min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 min-w-0 truncate text-sm text-foreground tabular-nums',
          mono && 'font-mono'
        )}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}

export const KeeperConnectionExpandedDetails =
  function KeeperConnectionExpandedDetails({
    row,
  }: KeeperConnectionExpandedDetailsProps) {
    const index = toStringSafe(row.index)
    const clientId = toStringSafe(row.client_id)
    const xid = toStringSafe(row.xid)
    const keeperApiVersion = toStringSafe(row.keeper_api_version)
    const sessionTimeoutMs = toStringSafe(row.session_timeout_ms)
    const lastZxidSeen = toStringSafe(row.last_zxid_seen)
    const enabledFeatureFlags = toStringSafe(row.enabled_feature_flags)
    const availabilityZone = toStringSafe(row.availability_zone)

    return (
      <div
        data-slot="keeper-connection-expanded"
        className="border-t border-border/60 bg-muted/20 p-4"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <DetailField icon={LayersIcon} label="Index" value={index} mono />
          <DetailField
            icon={FingerprintIcon}
            label="Client ID"
            value={clientId}
            mono
          />
          <DetailField icon={FingerprintIcon} label="XID" value={xid} mono />
          <DetailField
            icon={DatabaseIcon}
            label="Keeper API Version"
            value={keeperApiVersion}
            mono
          />
          <DetailField
            icon={TimerIcon}
            label="Session Timeout (ms)"
            value={sessionTimeoutMs}
            mono
          />
          <DetailField
            icon={ClockIcon}
            label="Last ZXID Seen"
            value={lastZxidSeen}
            mono
          />
          <DetailField
            icon={LayersIcon}
            label="Feature Flags"
            value={enabledFeatureFlags}
            className="sm:col-span-2"
          />
          <DetailField
            icon={MapPinIcon}
            label="Availability Zone"
            value={availabilityZone}
          />
        </div>
      </div>
    )
  }

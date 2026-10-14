import {
  BoxIcon,
  CloudIcon,
  DatabaseIcon,
  HardDriveIcon,
  LeafIcon,
  type LucideIcon,
  RadioTowerIcon,
  SearchIcon,
  ServerIcon,
  SnowflakeIcon,
} from 'lucide-react'

import type { DBType } from '@/lib/peerdb/types'

import { dbTypeLabel, normalizeDbType } from './peerdb-utils'
import { cn } from '@/lib/utils'

interface IconConfig {
  Icon: LucideIcon
  /** Tailwind text-color class for the icon. */
  color: string
}

/**
 * lucide has no brand glyphs for Postgres/ClickHouse/etc., so each peer type
 * maps to a representative generic icon + a recognizable accent color.
 */
const ICON_BY_TYPE: Record<string, IconConfig> = {
  POSTGRES: { Icon: DatabaseIcon, color: 'text-sky-600 dark:text-sky-400' },
  CLICKHOUSE: {
    Icon: DatabaseIcon,
    color: 'text-amber-500 dark:text-amber-400',
  },
  MYSQL: { Icon: DatabaseIcon, color: 'text-blue-600 dark:text-blue-400' },
  MONGO: { Icon: LeafIcon, color: 'text-green-600 dark:text-green-400' },
  KAFKA: {
    Icon: RadioTowerIcon,
    color: 'text-zinc-700 dark:text-zinc-300',
  },
  EVENTHUB: { Icon: RadioTowerIcon, color: 'text-indigo-500' },
  PUBSUB: { Icon: RadioTowerIcon, color: 'text-rose-500' },
  S3: { Icon: HardDriveIcon, color: 'text-orange-500' },
  BIGQUERY: { Icon: CloudIcon, color: 'text-blue-500' },
  SNOWFLAKE: { Icon: SnowflakeIcon, color: 'text-cyan-500' },
  ELASTICSEARCH: { Icon: SearchIcon, color: 'text-yellow-500' },
  SQLSERVER: { Icon: ServerIcon, color: 'text-red-500' },
  UNKNOWN: { Icon: BoxIcon, color: 'text-muted-foreground' },
}

export function getPeerTypeIcon(type?: DBType): IconConfig {
  return ICON_BY_TYPE[normalizeDbType(type)] ?? ICON_BY_TYPE.UNKNOWN
}

interface PeerTypeIconProps {
  type?: DBType
  className?: string
}

export function PeerTypeIcon({ type, className }: PeerTypeIconProps) {
  const { Icon, color } = getPeerTypeIcon(type)
  return (
    <Icon
      className={cn('size-4 shrink-0', color, className)}
      aria-label={dbTypeLabel(type)}
    />
  )
}

interface PeerTypeBadgeProps {
  name?: string
  type?: DBType
  className?: string
}

/** Icon + peer name, used in tables and the source→destination cell. */
export function PeerTypeBadge({ name, type, className }: PeerTypeBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <PeerTypeIcon type={type} />
      <span className="truncate">{name ?? dbTypeLabel(type)}</span>
    </span>
  )
}

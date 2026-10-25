import type { DBType } from '@/lib/peerdb/types'

import { normalizeDbType, peerKind } from './peerdb-utils'
import { DbLogo, hasDbLogo } from '@/components/icons/peerdb-logo'
import { cn } from '@/lib/utils'

interface PeerChipProps {
  name?: string
  type?: DBType
  size?: 'xs' | 'sm' | 'lg'
  dim?: boolean
  className?: string
}

export function PeerChip({
  name,
  type,
  size = 'sm',
  dim = false,
  className,
}: PeerChipProps) {
  const normalizedType = normalizeDbType(type)
  const k = peerKind(normalizedType)

  const shell =
    size === 'lg'
      ? 'h-7 text-[12px]'
      : size === 'xs'
        ? 'h-5 text-[10.5px] max-sm:text-xs'
        : 'h-6 text-[11.5px] max-sm:text-xs'
  const mono =
    size === 'lg'
      ? 'w-7 h-full text-[10.5px] max-sm:text-xs rounded-l-[5px]'
      : size === 'xs'
        ? 'w-5 h-full text-[8.5px] max-sm:text-xs rounded-l-[4px]'
        : 'w-6 h-full text-[9.5px] max-sm:text-xs rounded-l-[5px]'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-card pr-2 overflow-hidden',
        shell,
        dim && 'opacity-70',
        className
      )}
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-mono font-bold',
          mono
        )}
        style={{ background: k.bg, color: k.fg }}
      >
        {hasDbLogo(normalizedType) ? (
          <DbLogo type={normalizedType} className="size-full p-[3.5px]" />
        ) : (
          k.mono
        )}
      </span>
      <span className="max-w-[140px] truncate font-medium" title={name}>
        {name ?? k.label}
      </span>
    </span>
  )
}

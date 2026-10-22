import { LockIcon, ScissorsIcon, UsersIcon } from 'lucide-react'

import type { CellAccess } from '@/lib/security/access-matrix'

import { cn } from '@/lib/utils'

const LEVEL_CLASS: Record<CellAccess['level'], string> = {
  none: 'text-muted-foreground/60',
  read: 'bg-chart-blue/15 text-foreground',
  write: 'bg-chart-yellow/20 text-foreground',
  admin: 'bg-chart-red/15 text-foreground',
}

const ICON = 'size-3 shrink-0'

/** Level chip plus markers: via role, partial revoke, readonly cap. */
export function AccessChip({ cell }: { cell: CellAccess }) {
  const hasAny = cell.level !== 'none' || cell.narrowerGrants
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          'rounded px-1.5 py-0.5 font-mono text-[11px] leading-none',
          LEVEL_CLASS[cell.level]
        )}
      >
        {cell.level === 'none' && cell.narrowerGrants ? 'some' : cell.level}
      </span>
      {hasAny && cell.viaRole && (
        <UsersIcon
          className={ICON}
          strokeWidth={1.5}
          aria-label="through a role"
        />
      )}
      {cell.partialRevoke && (
        <ScissorsIcon
          className={ICON}
          strokeWidth={1.5}
          aria-label="partial revoke"
        />
      )}
      {cell.readonly && (
        <LockIcon
          className={ICON}
          strokeWidth={1.5}
          aria-label={`readonly = ${cell.readonly.value}`}
        />
      )}
    </span>
  )
}

export function AccessLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <UsersIcon className={ICON} strokeWidth={1.5} /> through a role
      </span>
      <span className="inline-flex items-center gap-1">
        <ScissorsIcon className={ICON} strokeWidth={1.5} /> a narrower REVOKE is
        carved out
      </span>
      <span className="inline-flex items-center gap-1">
        <LockIcon className={ICON} strokeWidth={1.5} /> capped by a readonly
        profile
      </span>
      <span>
        <span className="font-mono">some</span>: only some tables or columns
      </span>
    </div>
  )
}

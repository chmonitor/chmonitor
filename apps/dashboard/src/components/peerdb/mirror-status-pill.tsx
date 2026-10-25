import type { FlowStatus } from '@/lib/peerdb/types'

import { DESIGN_STATUS_META, toDesignStatus } from './peerdb-utils'
import { cn } from '@/lib/utils'

interface MirrorStatusPillProps {
  status?: FlowStatus
  className?: string
}

/** Inline hex tints (dot + '14'/'40') keep the tone identical across themes. */
export function MirrorStatusPill({ status, className }: MirrorStatusPillProps) {
  const meta = DESIGN_STATUS_META[toDesignStatus(status)]
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-[10.5px] max-sm:text-xs font-semibold',
        className
      )}
      style={{
        background: `${meta.dot}14`,
        color: meta.dot,
        borderColor: `${meta.dot}40`,
      }}
      title={status}
    >
      <span className="relative inline-flex">
        <span
          className="size-1.5 rounded-full"
          style={{ background: meta.dot }}
        />
        {meta.pulse && (
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{ background: meta.dot, opacity: 0.5 }}
          />
        )}
      </span>
      {meta.label}
    </span>
  )
}

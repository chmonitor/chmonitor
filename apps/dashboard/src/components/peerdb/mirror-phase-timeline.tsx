import type { FlowStatus } from '@/lib/peerdb/types'

import {
  DESIGN_STATUS_META,
  resolveMirrorPhase,
  toDesignStatus,
} from './peerdb-utils'
import { cn } from '@/lib/utils'

/** Human-readable phase summary for the row sub-label. */
export function phaseLabel(status?: string): string {
  switch (status) {
    case 'STATUS_RUNNING':
      return 'CDC streaming'
    case 'STATUS_SNAPSHOT':
      return 'Initial snapshot'
    case 'STATUS_SETUP':
      return 'Setup'
    case 'STATUS_PAUSED':
    case 'STATUS_PAUSING':
      return 'Paused (user)'
    case 'STATUS_FAILED':
    case 'STATUS_TERMINATED':
      return 'Error · awaiting operator'
    default:
      return 'Unknown'
  }
}

const DONE_COLOR = '#10b981'

export function PhaseTimeline({
  status,
  isCdc,
}: {
  status?: FlowStatus
  isCdc: boolean
}) {
  const { nodes, currentIdx, mode } = resolveMirrorPhase(status, isCdc)
  const currentColor =
    mode === 'failed'
      ? '#f43f5e'
      : mode === 'paused'
        ? '#f59e0b'
        : DESIGN_STATUS_META[toDesignStatus(status)].dot
  return (
    <div className="flex items-stretch gap-0">
      {nodes.map((n, i) => {
        const done = i < currentIdx
        const cur = i === currentIdx
        const last = i === nodes.length - 1
        const tone = done ? DONE_COLOR : cur ? currentColor : 'var(--border)'
        const isComplete =
          done || (cur && mode === 'progress' && n.id === 'snapshot_done')
        const marker = isComplete
          ? '✓'
          : mode === 'failed' && cur
            ? '!'
            : mode === 'paused' && cur
              ? '‖'
              : String(i + 1)
        // Pending steps use a light border-colored fill; white text on it is
        // illegible, so fall back to the muted foreground for those markers.
        const pending = !done && !cur
        return (
          <div
            key={n.id}
            className="flex flex-1 items-start gap-0 last:flex-none"
          >
            <div className="flex shrink-0 items-start gap-2">
              <span
                className={cn(
                  'relative mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  pending ? 'text-muted-foreground' : 'text-white'
                )}
                style={{
                  background: tone,
                  boxShadow: cur ? `0 0 0 3px ${currentColor}33` : undefined,
                }}
              >
                {marker}
                {cur && mode === 'progress' && (
                  <span
                    className="absolute inset-0 animate-ping rounded-full"
                    style={{ background: currentColor, opacity: 0.45 }}
                  />
                )}
              </span>
              <div className="flex flex-col leading-tight">
                <span
                  className={cn(
                    'whitespace-nowrap text-[11px] font-medium',
                    done
                      ? 'text-foreground'
                      : cur
                        ? ''
                        : 'text-muted-foreground'
                  )}
                  style={cur ? { color: currentColor } : undefined}
                >
                  {n.label}
                  {cur && mode === 'paused' && (
                    <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                      · paused
                    </span>
                  )}
                  {cur && mode === 'failed' && (
                    <span className="ml-1.5 text-rose-600 dark:text-rose-400">
                      · error
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-[9.5px] text-muted-foreground/80">
                  {n.hint}
                </span>
              </div>
            </div>
            {!last && (
              <div
                className="mx-2 mt-2.5 min-w-[12px] flex-1 self-start rounded-full"
                style={{
                  height: 2,
                  background: done ? DONE_COLOR : 'var(--border)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

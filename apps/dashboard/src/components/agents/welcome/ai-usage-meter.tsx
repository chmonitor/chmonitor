'use client'

/**
 * AiUsageMeter — the single shared rendering of the daily AI-message allowance,
 * used both as a compact composer chip and as a sidebar progress panel
 * (issue #2809). One source of truth for the quota colours + copy.
 *
 * Cloud-only: {@link useAiQuota} resolves `show: false` on OSS, for unlimited
 * plans, and on any endpoint error/absence, so every variant renders nothing in
 * those cases.
 */

import { useAiQuota } from '@/lib/ai/agent/use-ai-quota'
import { cn } from '@/lib/utils'

interface AiUsageMeterProps {
  /** `chip` = inline composer chip, `panel` = sidebar progress bar. */
  variant?: 'chip' | 'panel'
  className?: string
}

/** Shared severity → colour resolution so the chip and panel never diverge. */
function useQuotaState() {
  const quota = useAiQuota()
  if (!quota.show || quota.limit === null) return null
  const { used, limit, remaining } = quota
  const depleted = remaining !== null && remaining <= 0
  const low = remaining !== null && remaining > 0 && remaining <= 1
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const usedColor = depleted
    ? 'text-destructive'
    : low
      ? 'text-[var(--chart-yellow)]'
      : 'text-foreground'
  return { used, limit, remaining, depleted, low, pct, usedColor }
}

export function AiUsageMeter({
  variant = 'chip',
  className,
}: AiUsageMeterProps) {
  const state = useQuotaState()
  if (!state) return null
  const { used, limit, remaining, depleted, low, pct, usedColor } = state

  if (variant === 'chip') {
    return (
      <span
        className={cn(
          'text-muted-foreground ml-auto flex items-center gap-1 px-1 text-[11px] tabular-nums',
          className
        )}
        title={
          depleted
            ? "You've used all of today's AI messages. Resets tomorrow."
            : `${remaining} of ${limit} daily AI messages left`
        }
      >
        <span className={cn('font-medium', usedColor)}>{used}</span>
        <span>/{limit} today</span>
      </span>
    )
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            depleted
              ? 'bg-destructive'
              : low
                ? 'bg-[var(--chart-yellow)]'
                : 'bg-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-muted-foreground text-[10.5px] leading-snug">
        {depleted
          ? "You've used all of today's messages. The limit resets tomorrow."
          : `${remaining} message${remaining === 1 ? '' : 's'} left today`}
      </p>
    </div>
  )
}

/** The count badge shown in a sidebar section header (`used / limit`). */
export function AiUsageMeterBadge({ className }: { className?: string }) {
  const state = useQuotaState()
  if (!state) return null
  const { used, limit, usedColor } = state
  return (
    <span
      className={cn(
        'text-muted-foreground text-[10px] tabular-nums',
        className
      )}
    >
      <span className={cn('font-medium', usedColor)}>{used}</span>/{limit}
    </span>
  )
}

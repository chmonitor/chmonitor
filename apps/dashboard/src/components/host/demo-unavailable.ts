import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

/**
 * Whether to show the "Demo temporarily unavailable" banner: only for the
 * public cloud demo host, and only once its host-status probe has failed.
 * Self-hosted (`env`) and user-owned (`browser`/`database`) hosts keep their
 * normal per-card error states.
 */
export function isDemoUnavailable(
  source: MergedHostInfo['source'] | undefined,
  hostStatusError: unknown
): boolean {
  return source === 'demo' && Boolean(hostStatusError)
}

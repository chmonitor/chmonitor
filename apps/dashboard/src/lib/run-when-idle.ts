/**
 * Run `task` once the browser is idle, or after `timeoutMs` at the latest.
 * Used to keep third-party SDK downloads (Sentry, PostHog) off the critical
 * path of first paint. Where requestIdleCallback is missing (Safari) it waits
 * the full timeout.
 */
export function runWhenIdle(task: () => void, timeoutMs = 3000): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => task(), { timeout: timeoutMs })
    return
  }
  setTimeout(task, timeoutMs)
}

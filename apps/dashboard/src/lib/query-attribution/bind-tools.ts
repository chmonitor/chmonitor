import {
  currentAttributionScope,
  runWithAttribution,
} from '@chm/clickhouse-client/attribution'

/**
 * Re-enter the request's attribution scope inside each tool's `execute`.
 *
 * The AI SDK may run a tool while the response stream is being pulled, after
 * the request middleware's async context is gone. The scope is captured here,
 * where the tools are built inside the request, so agent queries keep their
 * principal and `source: 'agent'`.
 */
export function bindToolsToAttribution<T extends Record<string, unknown>>(
  tools: T
): T {
  const scope = { ...currentAttributionScope(), source: 'agent' }
  const out: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const execute =
      tool && typeof tool === 'object'
        ? (tool as { execute?: unknown }).execute
        : undefined
    out[name] =
      typeof execute === 'function'
        ? {
            ...(tool as object),
            execute: (...args: unknown[]) =>
              runWithAttribution(scope, () =>
                (execute as (...a: unknown[]) => unknown)(...args)
              ),
          }
        : tool
  }
  return out as T
}

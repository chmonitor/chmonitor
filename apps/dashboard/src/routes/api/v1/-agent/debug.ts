/**
 * Verbose agent request/usage logging. Opt-in via an explicit AGENT_DEBUG flag
 * rather than `NODE_ENV !== 'production'`: a self-hosted deploy that runs with
 * NODE_ENV unset would otherwise log request internals (message keys, resolved
 * user ids, usage) by default. Fails closed — off unless AGENT_DEBUG is truthy.
 */
export const AGENT_DEBUG_LOGS = (() => {
  const raw = process.env.AGENT_DEBUG?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
})()

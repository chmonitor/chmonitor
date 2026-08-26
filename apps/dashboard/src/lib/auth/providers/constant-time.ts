/**
 * Timing-safe secret comparison, shared by the reverse-proxy auth providers
 * (`proxy`, `trusted`) and cron routes.
 *
 * Both providers trust a proxy-supplied identity header ONLY when a shared
 * secret header matches the configured secret. Comparing that secret with a
 * normal `===` leaks length/prefix information through timing; a single
 * constant-time comparator removes that and avoids the two providers drifting
 * apart on a security-critical primitive.
 *
 * Canonical implementation lives in `@chm/mcp-server/auth/timing`.
 */

export {
  constantTimeEqual,
  timingSafeEqualString as secretsMatch,
} from '@chm/mcp-server/auth'

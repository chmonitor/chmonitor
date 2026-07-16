/**
 * BYOK (bring-your-own-key) support for the AI advisor/agent.
 *
 * A user on any plan (Free / Pro / …) may supply their own model-provider API
 * key with an agent request. When they do, the request runs against *their*
 * credit with the provider, so chmonitor skips its own included-credit metering
 * entirely (no daily reservation, no monthly USD budget, no overage) — see the
 * agent route. This expands the funnel (Free users can keep using the advisor
 * past the daily cap by paying the provider directly) and protects margin.
 *
 * The key is accepted per-request only. It is NEVER persisted server-side and
 * NEVER logged: it is forwarded straight to the provider SDK for that one
 * request and then discarded. Keeping it out of any store is deliberate —
 * secrets don't belong in the conversation history or the D1 usage tables.
 */

/** Minimum plausible length for a provider API key (rejects stray/empty input). */
export const BYOK_MIN_KEY_LENGTH = 8
/** Upper bound — real keys are well under this; guards against abuse/junk. */
export const BYOK_MAX_KEY_LENGTH = 512

/** True when every character is printable ASCII (0x21–0x7e), i.e. no space or
 * control character that would break an Authorization header. */
function isPrintableAsciiToken(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x21 || code > 0x7e) return false
  }
  return true
}

/**
 * Validate and normalize a caller-supplied BYOK API key.
 *
 * Returns the trimmed key when it looks like a usable credential, or `null`
 * when absent/malformed so callers can treat "no BYOK" and "invalid BYOK" the
 * same way (fall back to the deployment's own provider key + metering).
 *
 * Intentionally permissive about *shape* (providers differ) but strict about
 * safety: single-line, bounded length, printable ASCII only. Punctuation like
 * `-` / `_` (common in `sk-...` keys) is allowed.
 */
export function parseByokApiKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (key.length < BYOK_MIN_KEY_LENGTH || key.length > BYOK_MAX_KEY_LENGTH) {
    return null
  }
  if (!isPrintableAsciiToken(key)) return null
  return key
}

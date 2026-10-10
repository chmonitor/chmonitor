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
 * A key sent with a request is used for that request only and NEVER logged:
 * it is forwarded straight to the provider SDK and then discarded. It never
 * goes into the conversation history or the D1 usage tables. The one stored
 * exception is an AnyRouter sign-in token a signed-in user chose to keep,
 * which lives encrypted in `user-token-store.ts` (see `selectAgentApiKey`).
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

/** Where the key for one agent request came from. */
export type AgentApiKeySource = 'request' | 'stored' | 'deployment'

export interface AgentApiKeySelection {
  /** The user's key for this request, or null → the deployment's env key. */
  readonly apiKey: string | null
  readonly source: AgentApiKeySource
}

/**
 * Pick the key for one agent request, in this order:
 *   1. the key sent with the request (BYOK, or a guest's AnyRouter token),
 *   2. the signed-in user's stored AnyRouter token (only for `anyrouter:`
 *      models, only when "Sign in with AnyRouter" is on),
 *   3. nothing → the deployment's own key, with normal metering.
 *
 * Any user key (1 or 2) counts as BYOK: no included-credit metering.
 * `loadStoredToken` is only called when step 2 applies; when it throws, the
 * request falls back to step 3 (a store outage never blocks the agent).
 */
export async function selectAgentApiKey(input: {
  readonly requestApiKey: string | null
  readonly signedIn: boolean
  readonly anyrouterSigninEnabled: boolean
  readonly anyrouterModel: boolean
  readonly loadStoredToken: () => Promise<string | null>
}): Promise<AgentApiKeySelection> {
  if (input.requestApiKey) {
    return { apiKey: input.requestApiKey, source: 'request' }
  }
  if (input.signedIn && input.anyrouterSigninEnabled && input.anyrouterModel) {
    try {
      const stored = parseByokApiKey(await input.loadStoredToken())
      if (stored) return { apiKey: stored, source: 'stored' }
    } catch (error) {
      // Never log the token; the error name is enough.
      console.warn(
        '[Agent API] Stored AnyRouter token unavailable, using deployment key:',
        error instanceof Error ? error.name : typeof error
      )
    }
  }
  return { apiKey: null, source: 'deployment' }
}

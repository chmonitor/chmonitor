/**
 * `CHM_AGENT_ANYROUTER_SIGNIN_ENABLED` — the one switch for "Sign in with
 * AnyRouter".
 *
 * Off by default (self-hosted keeps today's behaviour exactly); the hosted
 * product turns it on in `apps/dashboard/.env.production`. When on:
 * - the login/callback/token routes answer (otherwise 404),
 * - a guest may send their own AnyRouter token and skip the free daily cap,
 * - a signed-in user's token can be stored encrypted on the server.
 *
 * Only an explicit truthy value enables it. Unset or junk → off (fail closed).
 */

import { parseModelId } from '@/lib/ai/providers'

export const ANYROUTER_SIGNIN_ENV = 'CHM_AGENT_ANYROUTER_SIGNIN_ENABLED'

export function parseAnyRouterSigninEnabled(raw: string | undefined): boolean {
  if (!raw) return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

export function isAnyRouterSigninEnabled(): boolean {
  if (typeof process === 'undefined') return false
  return parseAnyRouterSigninEnabled(process.env[ANYROUTER_SIGNIN_ENV])
}

/**
 * True when the model id routes to the AnyRouter provider (`anyrouter:<id>`).
 * A bare `anyrouter/free` (no `anyrouter:` prefix) parses as `legacy` and goes
 * to OpenRouter, so an AnyRouter token must never be sent with it.
 */
export function isAnyRouterProviderModel(model: string | undefined): boolean {
  if (typeof model !== 'string' || !model.trim()) return false
  return parseModelId(model.trim()).provider === 'anyrouter'
}

/** 404 body the flag-gated routes return when the feature is off. */
export function anyRouterSigninDisabledResponse(): Response {
  return Response.json(
    {
      error: {
        code: 'anyrouter_signin_disabled',
        message: 'Sign in with AnyRouter is not enabled on this deployment.',
      },
    },
    { status: 404 }
  )
}

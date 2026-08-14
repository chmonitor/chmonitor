/**
 * Cloud-only guest (anonymous) AI identity, daily cap, and per-minute limit.
 *
 * Anonymous Cloud visitors share the deployment's AnyRouter key. They get a
 * stable per-IP owner id (`guest:<sha256-prefix>`) so usage is tracked in the
 * existing `ai_usage_daily` store without collapsing every visitor into one
 * global `guest` bucket. OSS / self-host never reads these helpers — agent
 * gating stays fail-closed to unlimited.
 */

import type { Plan } from './plans'

import { BILLING_PLANS } from './plans'

/** Default daily message cap for anonymous Cloud visitors. ≤ Free (5). */
export const GUEST_AI_REQUESTS_PER_DAY = 3

/** Default per-minute identity rate limit for anonymous Cloud visitors. */
export const DEFAULT_GUEST_AI_RATE_LIMIT_PER_MIN = 5

const GUEST_OWNER_PREFIX = 'guest:'
const GUEST_HASH_HEX_LEN = 16

/**
 * Read a positive integer env var; fall back to `defaultValue` on unset/junk.
 * Fail-closed to the default (never 0 / NaN / negative).
 */
function readPositiveIntEnv(key: string, defaultValue: number): number {
  if (typeof process === 'undefined') return defaultValue
  const raw = process.env[key]
  if (!raw || !/^\d+$/.test(raw.trim())) return defaultValue
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

/**
 * Stable per-visitor billing owner id derived from the client IP.
 * `guest:` + first 16 hex chars of SHA-256(ip). Same IP → same id.
 */
export async function guestOwnerIdFromIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ip)
  )
  return `${GUEST_OWNER_PREFIX}${bytesToHex(digest).slice(0, GUEST_HASH_HEX_LEN)}`
}

/** True when `ownerId` is a per-visitor guest key (`guest:<hash>`). */
export function isGuestOwnerId(ownerId: string): boolean {
  return ownerId.startsWith(GUEST_OWNER_PREFIX) && ownerId !== 'guest'
}

/**
 * Daily guest message cap. Env `CHM_GUEST_AI_REQUESTS_PER_DAY`, default 3.
 * Unset/junk/non-positive → default.
 */
export function getGuestAiRequestsPerDay(): number {
  return readPositiveIntEnv(
    'CHM_GUEST_AI_REQUESTS_PER_DAY',
    GUEST_AI_REQUESTS_PER_DAY
  )
}

/**
 * Per-minute identity rate limit for Cloud guests.
 * Env `RATE_LIMIT_AGENT_GUEST_PER_MIN`, default 5. Signed-in stays
 * `RATE_LIMIT_AGENT_PER_MIN` (default 10).
 */
export function getGuestAiRateLimitPerMin(): number {
  return readPositiveIntEnv(
    'RATE_LIMIT_AGENT_GUEST_PER_MIN',
    DEFAULT_GUEST_AI_RATE_LIMIT_PER_MIN
  )
}

/**
 * Synthetic hard-capped plan used only for guest daily-message checks.
 * No monthly USD budget, no overage. `id` stays `free` for Plan typing;
 * API responses override `planId` to `'guest'`.
 */
export function getGuestAiPlan(): Plan {
  return {
    ...BILLING_PLANS.free,
    name: 'Guest',
    tagline: 'Anonymous Cloud visitor',
    aiRequestsPerDay: getGuestAiRequestsPerDay(),
    aiMonthlyUsdBudget: null,
    aiOverage: null,
  }
}

/** 402 copy for a guest who exhausted today's messages. No Polar jargon. */
export function guestDailyLimitMessage(limit: number): string {
  return `You've reached the guest daily AI limit of ${limit} requests. Sign in for a higher allowance, or try again tomorrow.`
}

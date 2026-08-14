import {
  DEFAULT_GUEST_AI_RATE_LIMIT_PER_MIN,
  GUEST_AI_REQUESTS_PER_DAY,
  getGuestAiPlan,
  getGuestAiRateLimitPerMin,
  getGuestAiRequestsPerDay,
  guestDailyLimitMessage,
  guestOwnerIdFromIp,
  isGuestOwnerId,
} from './guest-ai'
import { afterEach, describe, expect, test } from 'bun:test'

const ENV_KEYS = [
  'CHM_GUEST_AI_REQUESTS_PER_DAY',
  'RATE_LIMIT_AGENT_GUEST_PER_MIN',
] as const

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {}

function snapshotEnv(): void {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
}

describe('guestOwnerIdFromIp', () => {
  test('is stable for the same IP', async () => {
    const a = await guestOwnerIdFromIp('203.0.113.10')
    const b = await guestOwnerIdFromIp('203.0.113.10')
    expect(a).toBe(b)
  })

  test('is prefixed guest: and uses a 16-char hex hash', async () => {
    const id = await guestOwnerIdFromIp('198.51.100.7')
    expect(id).toMatch(/^guest:[0-9a-f]{16}$/)
    expect(isGuestOwnerId(id)).toBe(true)
  })

  test('different IPs produce different ids', async () => {
    const a = await guestOwnerIdFromIp('203.0.113.10')
    const b = await guestOwnerIdFromIp('203.0.113.11')
    expect(a).not.toBe(b)
  })

  test('does not collapse every visitor onto the literal guest id', async () => {
    const id = await guestOwnerIdFromIp('192.0.2.1')
    expect(id).not.toBe('guest')
    expect(isGuestOwnerId('guest')).toBe(false)
  })
})

describe('getGuestAiRequestsPerDay', () => {
  snapshotEnv()
  afterEach(() => {
    restoreEnv()
  })

  test('defaults to 3 when unset', () => {
    delete process.env.CHM_GUEST_AI_REQUESTS_PER_DAY
    expect(getGuestAiRequestsPerDay()).toBe(GUEST_AI_REQUESTS_PER_DAY)
    expect(GUEST_AI_REQUESTS_PER_DAY).toBe(3)
  })

  test('fail-closed to the default on junk / non-positive', () => {
    for (const junk of ['', 'nope', '0', '-2', '1.5']) {
      process.env.CHM_GUEST_AI_REQUESTS_PER_DAY = junk
      expect(getGuestAiRequestsPerDay()).toBe(3)
    }
  })

  test('honors a positive override', () => {
    process.env.CHM_GUEST_AI_REQUESTS_PER_DAY = '2'
    expect(getGuestAiRequestsPerDay()).toBe(2)
  })
})

describe('getGuestAiRateLimitPerMin', () => {
  snapshotEnv()
  afterEach(() => {
    restoreEnv()
  })

  test('defaults to 5 when unset', () => {
    delete process.env.RATE_LIMIT_AGENT_GUEST_PER_MIN
    expect(getGuestAiRateLimitPerMin()).toBe(
      DEFAULT_GUEST_AI_RATE_LIMIT_PER_MIN
    )
    expect(DEFAULT_GUEST_AI_RATE_LIMIT_PER_MIN).toBe(5)
  })

  test('fail-closed to the default on junk', () => {
    process.env.RATE_LIMIT_AGENT_GUEST_PER_MIN = 'abc'
    expect(getGuestAiRateLimitPerMin()).toBe(5)
  })

  test('honors a positive override', () => {
    process.env.RATE_LIMIT_AGENT_GUEST_PER_MIN = '3'
    expect(getGuestAiRateLimitPerMin()).toBe(3)
  })
})

describe('getGuestAiPlan', () => {
  snapshotEnv()
  afterEach(() => {
    restoreEnv()
  })

  test('hard-caps daily messages and has no monthly USD budget', () => {
    delete process.env.CHM_GUEST_AI_REQUESTS_PER_DAY
    const plan = getGuestAiPlan()
    expect(plan.name).toBe('Guest')
    expect(plan.aiRequestsPerDay).toBe(3)
    expect(plan.aiMonthlyUsdBudget).toBeNull()
    expect(plan.aiOverage).toBeNull()
  })
})

describe('guestDailyLimitMessage', () => {
  test('mentions the cap and signing in, not Polar', () => {
    const msg = guestDailyLimitMessage(3)
    expect(msg).toContain('guest daily AI limit of 3')
    expect(msg.toLowerCase()).toContain('sign in')
    expect(msg.toLowerCase()).not.toContain('polar')
    expect(msg.toLowerCase()).not.toContain('upgrade')
  })
})

/**
 * GET /api/v1/config exposes `agent.anyrouterSignin` from
 * CHM_AGENT_ANYROUTER_SIGNIN_ENABLED, default false (self-hosted).
 */
import { afterEach, describe, expect, test } from 'bun:test'

type GetHandler = () => Promise<Response>

const { Route } = await import('../config')
const handler = (
  Route.options.server as { handlers?: { GET?: GetHandler } } | undefined
)?.handlers?.GET
if (!handler) throw new Error('Route has no GET handler')

const FLAG = 'CHM_AGENT_ANYROUTER_SIGNIN_ENABLED'
const saved = process.env[FLAG]
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG]
  else process.env[FLAG] = saved
})

async function anyrouterSignin(): Promise<unknown> {
  const body = (await (await handler!()).json()) as {
    agent?: { anyrouterSignin?: unknown }
  }
  return body.agent?.anyrouterSignin
}

describe('GET /api/v1/config agent.anyrouterSignin', () => {
  test('unset or junk → false', async () => {
    delete process.env[FLAG]
    expect(await anyrouterSignin()).toBe(false)
    process.env[FLAG] = 'junk'
    expect(await anyrouterSignin()).toBe(false)
  })

  test('true → true', async () => {
    process.env[FLAG] = 'true'
    expect(await anyrouterSignin()).toBe(true)
  })
})

/**
 * Send-time SSRF guard for saved Matrix route targets. The API validates the
 * homeserver at save time, but DNS can change, so the sweep re-validates every
 * saved target before sending. The env-configured homeserver is operator-set
 * and trusted. Drives the real `validateHostUrl` with IP literals (no DNS).
 */

import { matrixChannelEntries, sendMatrixChannel } from './matrix'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const realFetch = globalThis.fetch
const savedAllowPrivate = process.env.CHM_ALLOW_PRIVATE_HOSTS
const TOKEN = 'syt_secret_token_value'
let fetched: string[] = []

beforeEach(() => {
  fetched = []
  delete process.env.CHM_ALLOW_PRIVATE_HOSTS
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    return new Response('{"event_id":"$e"}', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (savedAllowPrivate === undefined) {
    delete process.env.CHM_ALLOW_PRIVATE_HOSTS
  } else {
    process.env.CHM_ALLOW_PRIVATE_HOSTS = savedAllowPrivate
  }
})

type T = ReturnType<typeof target>

/** Send to each room like the digest flush does; true when any delivered. */
async function send(targets: T[], env: T | null): Promise<boolean> {
  let any = false
  for (const entry of matrixChannelEntries(targets, env)) {
    if ((await sendMatrixChannel(entry, { body: 'x' }, 'txn')).ok) any = true
  }
  return any
}

const target = (homeserverUrl: string) => ({
  homeserverUrl,
  accessToken: TOKEN,
  roomId: '!abc:example.org',
})

describe('sendMatrixChannel send-time SSRF guard', () => {
  test('control: a public saved target is sent', async () => {
    expect(await send([target('https://93.184.216.34')], null)).toBe(true)
    expect(fetched).toHaveLength(1)
  })

  test('a saved target resolving to loopback is never fetched', async () => {
    expect(await send([target('https://127.0.0.1')], null)).toBe(false)
    expect(fetched).toEqual([])
  })

  test('cloud metadata address is never fetched', async () => {
    expect(await send([target('https://169.254.169.254')], null)).toBe(false)
    expect(fetched).toEqual([])
  })

  test('a blocked target does not stop later valid targets', async () => {
    const ok = await send(
      [target('https://10.0.0.5'), target('https://93.184.216.34')],
      null
    )
    expect(ok).toBe(true)
    expect(fetched).toHaveLength(1)
    expect(fetched[0]).toStartWith('https://93.184.216.34/')
  })

  test('the env-configured homeserver is trusted, even on a LAN address', async () => {
    const env = target('http://10.0.0.5:8008')
    expect(await send([env], env)).toBe(true)
    expect(fetched).toHaveLength(1)
  })
})

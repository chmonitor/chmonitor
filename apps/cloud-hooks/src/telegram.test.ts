/**
 * Telegram Notifier — per-kind throttle + fail-safe delivery.
 */

import { Notifier } from './telegram'
import { describe, expect, mock, test } from 'bun:test'

function okFetch() {
  return mock(async () => new Response('{"ok":true}', { status: 200 }))
}

const cfg = { botToken: 'bot123', chatId: '42' }

describe('configuration guard', () => {
  test('returns false and never calls fetch when unconfigured', async () => {
    const fetchImpl = okFetch()
    const n = new Notifier({}, { fetch: fetchImpl })
    expect(await n.notify('subscription', 'hi')).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('per-kind throttle', () => {
  test('a second message of the same kind within the window is throttled', async () => {
    const fetchImpl = okFetch()
    let now = 1_000_000
    const n = new Notifier(cfg, { fetch: fetchImpl, now: () => now })

    expect(await n.notify('subscription', 'first')).toBe(true)
    now += 1_000 // within the 5s subscription window
    expect(await n.notify('subscription', 'second')).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('a different kind is not throttled by another kind', async () => {
    const fetchImpl = okFetch()
    const now = 1_000_000
    const n = new Notifier(cfg, { fetch: fetchImpl, now: () => now })

    expect(await n.notify('subscription', 'a')).toBe(true)
    expect(await n.notify('cancel', 'b')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test('the same kind is allowed again once the window elapses', async () => {
    const fetchImpl = okFetch()
    let now = 1_000_000
    const n = new Notifier(cfg, { fetch: fetchImpl, now: () => now })

    expect(await n.notify('probe', 'down')).toBe(true)
    now += 31_000 // past the 30s probe window
    expect(await n.notify('probe', 'up')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('fail-safe delivery', () => {
  test('a non-2xx response returns false without throwing', async () => {
    const fetchImpl = mock(async () => new Response('nope', { status: 500 }))
    const n = new Notifier(cfg, { fetch: fetchImpl, logError: () => {} })
    expect(await n.notify('error', 'x')).toBe(false)
  })

  test('a fetch rejection returns false without throwing', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('network down')
    })
    const n = new Notifier(cfg, { fetch: fetchImpl, logError: () => {} })
    expect(await n.notify('error', 'x')).toBe(false)
  })

  test('posts to the Bot API sendMessage endpoint with the chat id', async () => {
    const fetchImpl = okFetch()
    const n = new Notifier(cfg, { fetch: fetchImpl })
    await n.notify('daily_summary', 'report')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/botbot123/sendMessage')
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: '42',
      text: 'report',
    })
  })
})

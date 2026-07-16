import type { AlertPayload } from './adapters/types'

import { buildTelegramBody } from './adapters/telegram'
import { dispatchTelegram, telegramSendMessageUrl } from './telegram-dispatch'
import { describe, expect, test } from 'bun:test'

/** A fetch stub that records the request it was called with. */
function stubFetch(response: Response = new Response('ok', { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return response
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

function throwingFetch(err: unknown) {
  return (async () => {
    throw err
  }) as unknown as typeof fetch
}

const CONFIG = { botToken: '123456:ABC-DEF', chatId: '-1001234567890' }

const CRITICAL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 7,
  warnThreshold: 1,
  critThreshold: 5,
  title: 'Failed mutations',
  label: '7 failed mutations',
  timestamp: '2026-07-02T10:00:00.000Z',
}

const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  value: 0,
  label: 'recovered',
}

describe('telegramSendMessageUrl', () => {
  test('puts the token in the Bot API path', () => {
    expect(telegramSendMessageUrl('123456:ABC')).toBe(
      'https://api.telegram.org/bot123456:ABC/sendMessage'
    )
  })
})

describe('dispatchTelegram — send', () => {
  test('POSTs the built MarkdownV2 body to the sendMessage endpoint', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchTelegram(CRITICAL, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://api.telegram.org/bot123456:ABC-DEF/sendMessage'
    )
    expect(calls[0].init.method).toBe('POST')
    expect(
      (calls[0].init.headers as Record<string, string>)['Content-Type']
    ).toBe('application/json')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(
      buildTelegramBody(CRITICAL, {
        token: CONFIG.botToken,
        chatId: CONFIG.chatId,
      })
    )
  })

  test('sends a recovery message on the same endpoint', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchTelegram(RECOVERY, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    const body = JSON.parse(String(calls[0].init.body)) as { text: string }
    // MarkdownV2 header for a recovery renders RECOVERY.
    expect(body.text).toContain('RECOVERY')
  })

  test('returns false when Telegram responds non-OK, without throwing', async () => {
    const { fetchImpl } = stubFetch(new Response('nope', { status: 400 }))
    const ok = await dispatchTelegram(CRITICAL, CONFIG, { fetchImpl })
    expect(ok).toBe(false)
  })
})

describe('dispatchTelegram — fail-open', () => {
  test('returns false, never throws, when the fetch itself rejects', async () => {
    const fetchImpl = throwingFetch(new Error('network down'))
    await expect(
      dispatchTelegram(CRITICAL, CONFIG, { fetchImpl })
    ).resolves.toBe(false)
  })
})

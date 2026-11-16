import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

const { addReaction, postChatMessage, removeReaction } = await import('./api')

const TOKEN = 'xoxb-secret-api-test-token'

interface Call {
  method: string
  auth: string | null
  body: Record<string, unknown>
}

const realFetch = globalThis.fetch
let calls: Call[] = []
/** Slack answers, in order; `throw` makes fetch reject. */
let answers: (Record<string, unknown> | 'throw')[] = []

beforeEach(() => {
  calls = []
  answers = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      method: String(input).replace('https://slack.com/api/', ''),
      auth: headers.get('authorization'),
      body: JSON.parse(String(init?.body)),
    })
    const answer = answers.shift() ?? { ok: true, ts: '1.0001' }
    if (answer === 'throw') {
      throw new Error(`fetch failed for ${headers.get('authorization')}`)
    }
    return Response.json(answer)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const identity = { username: 'prod-eu', iconEmoji: ':rotating_light:' }

describe('postChatMessage bot identity', () => {
  test('sends the bot name and icon', async () => {
    const res = await postChatMessage({
      botToken: TOKEN,
      channel: 'C0ALERTS',
      message: { text: 'disk full' },
      identity,
    })
    expect(res).toEqual({ ok: true, ts: '1.0001' })
    expect(calls).toEqual([
      {
        method: 'chat.postMessage',
        auth: `Bearer ${TOKEN}`,
        body: {
          text: 'disk full',
          username: 'prod-eu',
          icon_emoji: ':rotating_light:',
          channel: 'C0ALERTS',
        },
      },
    ])
  })

  test('posts again without them when the token lacks chat:write.customize', async () => {
    answers = [
      { ok: false, error: 'missing_scope', needed: 'chat:write.customize' },
      { ok: true, ts: '2.0001' },
    ]
    const res = await postChatMessage({
      botToken: TOKEN,
      channel: 'C0ALERTS',
      message: { text: 'disk full', thread_ts: '1.0001' },
      identity,
    })
    expect(res).toEqual({ ok: true, ts: '2.0001' })
    expect(calls.map((c) => c.body)).toEqual([
      {
        text: 'disk full',
        thread_ts: '1.0001',
        username: 'prod-eu',
        icon_emoji: ':rotating_light:',
        channel: 'C0ALERTS',
      },
      { text: 'disk full', thread_ts: '1.0001', channel: 'C0ALERTS' },
    ])
  })

  test('does not retry when no name or icon was sent, or on another error', async () => {
    answers = [{ ok: false, error: 'missing_scope' }]
    expect(
      await postChatMessage({
        botToken: TOKEN,
        channel: 'C0ALERTS',
        message: { text: 'x' },
      })
    ).toEqual({ ok: false, error: 'missing_scope' })
    answers = [{ ok: false, error: 'channel_not_found' }]
    expect(
      await postChatMessage({
        botToken: TOKEN,
        channel: 'C0ALERTS',
        message: { text: 'x' },
        identity,
      })
    ).toEqual({ ok: false, error: 'channel_not_found' })
    expect(calls).toHaveLength(2)
  })
})

describe('reactions', () => {
  const at = { botToken: TOKEN, channel: 'C0ALERTS', ts: '1.0001' }

  test('adds and removes a reaction on a message', async () => {
    expect(await addReaction({ ...at, name: 'white_check_mark' })).toEqual({
      status: 'done',
    })
    expect(await removeReaction({ ...at, name: 'rotating_light' })).toEqual({
      status: 'done',
    })
    expect(calls).toEqual([
      {
        method: 'reactions.add',
        auth: `Bearer ${TOKEN}`,
        body: {
          channel: 'C0ALERTS',
          timestamp: '1.0001',
          name: 'white_check_mark',
        },
      },
      {
        method: 'reactions.remove',
        auth: `Bearer ${TOKEN}`,
        body: {
          channel: 'C0ALERTS',
          timestamp: '1.0001',
          name: 'rotating_light',
        },
      },
    ])
  })

  test('a reaction already there, already gone, or not allowed is skipped, not failed', async () => {
    answers = [
      { ok: false, error: 'already_reacted' },
      { ok: false, error: 'missing_scope' },
      { ok: false, error: 'no_reaction' },
      { ok: false, error: 'message_not_found' },
    ]
    expect(await addReaction({ ...at, name: 'eyes' })).toEqual({
      status: 'skipped',
      reason: 'already_reacted',
    })
    expect(await addReaction({ ...at, name: 'eyes' })).toEqual({
      status: 'skipped',
      reason: 'missing_scope',
    })
    expect(await removeReaction({ ...at, name: 'eyes' })).toEqual({
      status: 'skipped',
      reason: 'no_reaction',
    })
    expect(await removeReaction({ ...at, name: 'eyes' })).toEqual({
      status: 'failed',
      error: 'message_not_found',
    })
  })
})

describe('token safety', () => {
  test('a network failure returns a code, never the token, and logs nothing', async () => {
    const logged: unknown[] = []
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(...args)
      })
    )
    try {
      answers = ['throw', 'throw']
      const posted = await postChatMessage({
        botToken: TOKEN,
        channel: 'C0ALERTS',
        message: { text: 'x' },
        identity,
      })
      const reacted = await addReaction({
        botToken: TOKEN,
        channel: 'C0ALERTS',
        ts: '1.0001',
        name: 'eyes',
      })
      expect(posted).toEqual({ ok: false, error: 'network' })
      expect(reacted).toEqual({ status: 'failed', error: 'network' })
      expect(JSON.stringify([posted, reacted, logged])).not.toContain(TOKEN)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

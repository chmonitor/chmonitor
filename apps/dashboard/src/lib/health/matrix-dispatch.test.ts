import {
  buildMatrixSendUrl,
  dispatchMatrix,
  isValidMatrixRoomId,
  matrixTxnIdForPayload,
  parseMatrixHomeserverUrl,
} from './matrix-dispatch'
import { buildTestAlertPayload } from './test-alert-payload'
import { describe, expect, mock, test } from 'bun:test'

const TOKEN = 'syt_secret_token_value'
const CONFIG = {
  homeserverUrl: 'https://example.org/matrix/',
  accessToken: TOKEN,
  roomId: '!abc:example.org',
}

function okFetch() {
  return mock(
    async (_url: string, _init?: RequestInit) =>
      new Response('{"event_id":"$e"}', { status: 200 })
  )
}

describe('buildMatrixSendUrl', () => {
  test('encodes the room id and keeps the homeserver path prefix', () => {
    expect(buildMatrixSendUrl(CONFIG.homeserverUrl, CONFIG.roomId, 't1')).toBe(
      'https://example.org/matrix/_matrix/client/v3/rooms/%21abc%3Aexample.org/send/m.room.message/t1'
    )
  })
})

describe('isValidMatrixRoomId', () => {
  test('accepts room ids, rejects aliases, spaces and over-long ids', () => {
    expect(isValidMatrixRoomId('!abc:example.org')).toBe(true)
    expect(isValidMatrixRoomId('!opaque')).toBe(true)
    expect(isValidMatrixRoomId('#ops:example.org')).toBe(false)
    expect(isValidMatrixRoomId('!a b:example.org')).toBe(false)
    expect(isValidMatrixRoomId(`!${'a'.repeat(255)}`)).toBe(false)
  })
})

describe('dispatchMatrix', () => {
  test('PUTs with a Bearer header, token never in the URL, redirects not followed', async () => {
    const fetchImpl = okFetch()
    const res = await dispatchMatrix(buildTestAlertPayload(), CONFIG, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toStartWith(
      'https://example.org/matrix/_matrix/client/v3/rooms/%21abc%3Aexample.org/send/m.room.message/chm-'
    )
    expect(url).not.toContain(TOKEN)
    expect(init.method).toBe('PUT')
    expect(init.redirect).toBe('manual')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`
    )
    expect(JSON.parse(String(init.body)).msgtype).toBe('m.notice')
  })

  test('a 30x is a failure, not a followed redirect', async () => {
    const fetchImpl = mock(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example/' },
        })
    )
    const res = await dispatchMatrix(buildTestAlertPayload(), CONFIG, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('returns the Matrix errcode on failure and never throws', async () => {
    const forbidden = mock(
      async () =>
        new Response('{"errcode":"M_FORBIDDEN"}', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    expect(
      await dispatchMatrix(buildTestAlertPayload(), CONFIG, {
        fetchImpl: forbidden as unknown as typeof fetch,
      })
    ).toEqual({ ok: false, status: 403, errcode: 'M_FORBIDDEN' })
    const boom = mock(async () => {
      throw new Error('network down')
    })
    expect(
      await dispatchMatrix(buildTestAlertPayload(), CONFIG, {
        fetchImpl: boom as unknown as typeof fetch,
      })
    ).toEqual({ ok: false })
  })
})

describe('matrixTxnIdForPayload', () => {
  const payload = buildTestAlertPayload()

  test('a retry of the same notification reuses the txn id', async () => {
    expect(await matrixTxnIdForPayload(payload, '!a:x')).toBe(
      await matrixTxnIdForPayload({ ...payload }, '!a:x')
    )
  })

  test('another room, severity or minute gets a new txn id', async () => {
    const base = await matrixTxnIdForPayload(payload, '!a:x')
    expect(await matrixTxnIdForPayload(payload, '!b:x')).not.toBe(base)
    expect(
      await matrixTxnIdForPayload(
        {
          ...payload,
          severity: payload.severity === 'critical' ? 'warning' : 'critical',
        },
        '!a:x'
      )
    ).not.toBe(base)
    const later = new Date(Date.parse(payload.timestamp) + 60_000).toISOString()
    expect(
      await matrixTxnIdForPayload({ ...payload, timestamp: later }, '!a:x')
    ).not.toBe(base)
  })
})

describe('matrixTxnIdForPayload uniqueness', () => {
  const payload = buildTestAlertPayload()

  test('two notifications in the same minute get different txn ids', async () => {
    const first = { ...payload, timestamp: '2026-01-01T00:00:05.100Z' }
    const second = { ...payload, timestamp: '2026-01-01T00:00:05.900Z' }
    expect(await matrixTxnIdForPayload(first, '!a:x')).not.toBe(
      await matrixTxnIdForPayload(second, '!a:x')
    )
  })

  test('the same payload twice gets the same txn id', async () => {
    const p = { ...payload, timestamp: '2026-01-01T00:00:05.100Z' }
    expect(await matrixTxnIdForPayload(p, '!a:x')).toBe(
      await matrixTxnIdForPayload({ ...p }, '!a:x')
    )
  })
})

describe('parseMatrixHomeserverUrl', () => {
  test('returns origin + path with trailing slashes stripped', () => {
    expect(parseMatrixHomeserverUrl('https://Example.org/')).toBe(
      'https://example.org'
    )
    expect(parseMatrixHomeserverUrl('https://example.org/matrix//')).toBe(
      'https://example.org/matrix'
    )
  })

  test('rejects credentials, query, fragment, http and junk', () => {
    expect(parseMatrixHomeserverUrl('https://u:p@example.org')).toBeNull()
    expect(parseMatrixHomeserverUrl('https://u@example.org')).toBeNull()
    expect(parseMatrixHomeserverUrl('https://example.org?x=1')).toBeNull()
    expect(parseMatrixHomeserverUrl('https://example.org#frag')).toBeNull()
    expect(parseMatrixHomeserverUrl('http://example.org')).toBeNull()
    expect(parseMatrixHomeserverUrl('ftp://example.org')).toBeNull()
    expect(parseMatrixHomeserverUrl('not a url')).toBeNull()
  })

  test('allowHttp accepts http for operator env config', () => {
    expect(
      parseMatrixHomeserverUrl('http://192.168.1.5:8008/', { allowHttp: true })
    ).toBe('http://192.168.1.5:8008')
    expect(
      parseMatrixHomeserverUrl('http://u:p@h', { allowHttp: true })
    ).toBeNull()
  })
})

describe('buildMatrixSendUrl normalization', () => {
  test('a stored base with query or fragment cannot leak into the path', () => {
    expect(
      buildMatrixSendUrl('https://example.org/matrix?x=1#f', '!a:x', 't')
    ).toBe(
      'https://example.org/matrix/_matrix/client/v3/rooms/%21a%3Ax/send/m.room.message/t'
    )
  })
})

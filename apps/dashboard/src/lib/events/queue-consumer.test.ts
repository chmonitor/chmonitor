/**
 * Unit tests for queue-consumer.ts — the shared normalize→upsert pipeline
 * used by both the inline (no-binding) ingest path and a future live Queue
 * consumer. Asserts a batch of mixed valid/garbage messages acks the valid
 * ones, retries the invalid ones, and never throws.
 */

import { installEventsPlatformMock } from './__tests__/platform-mock'
import { beforeEach, describe, expect, test } from 'bun:test'

let currentDb: {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => { run: () => Promise<unknown> }
  }
} | null = null

installEventsPlatformMock(() => currentDb)

const { processEventBatch, processEventPayload } = await import(
  './queue-consumer'
)

function makeFakeD1() {
  const rows = new Map<string, unknown>()
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        run: async () => {
          rows.set('any', true)
          return { success: true, results: [], meta: {} }
        },
      }),
    }),
    rows,
  }
}

function makeMessage(body: unknown) {
  const calls = { acked: false, retried: false }
  return {
    id: 'msg-1',
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: () => {
      calls.acked = true
    },
    retry: () => {
      calls.retried = true
    },
    calls,
  }
}

beforeEach(() => {
  currentDb = makeFakeD1()
})

describe('processEventPayload', () => {
  test('normalizes and persists a valid payload', async () => {
    const result = await processEventPayload({
      title: 'Disk usage high',
      severity: 'critical',
      resource: 'ch-node-1',
    })
    expect(result?.event.title).toBe('Disk usage high')
    expect(result?.event.severity).toBe('critical')
    expect(result?.persisted).toBe(true)
  })

  test('never throws, even for wildly malformed input', async () => {
    await expect(processEventPayload(undefined)).resolves.toBeDefined()
    await expect(processEventPayload(Symbol('x'))).resolves.toBeDefined()
  })
})

describe('processEventBatch', () => {
  test('acks every message in a well-formed batch', async () => {
    const messages = [
      makeMessage({ title: 'Alert A', severity: 'critical', resource: 'a' }),
      makeMessage({ title: 'Alert B', severity: 'warning', resource: 'b' }),
    ]
    const batch = {
      messages,
      queue: 'chmonitor-inbound-events',
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      retryAll: () => {},
      ackAll: () => {},
    } as unknown as MessageBatch<unknown>

    const result = await processEventBatch(batch)
    expect(result).toEqual({ processed: 2, failed: 0 })
    expect(messages[0].calls.acked).toBe(true)
    expect(messages[1].calls.acked).toBe(true)
    expect(messages[0].calls.retried).toBe(false)
  })

  test('retries (does not ack) a message whose processing fails', async () => {
    // processEventPayload itself almost never returns null (normalize/store/
    // reemit all degrade internally rather than throw) — inject a stub to
    // exercise the retry() branch deterministically.
    const messages = [
      makeMessage({ title: 'Alert A', severity: 'critical', resource: 'a' }),
      makeMessage({ title: 'Alert B', severity: 'warning', resource: 'b' }),
    ]
    const batch = {
      messages,
      queue: 'chmonitor-inbound-events',
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      retryAll: () => {},
      ackAll: () => {},
    } as unknown as MessageBatch<unknown>

    let call = 0
    const processPayload = (async (payload: unknown) => {
      call += 1
      return call === 1 ? null : await processEventPayload(payload)
    }) as typeof processEventPayload

    const result = await processEventBatch(batch, { processPayload })
    expect(result).toEqual({ processed: 1, failed: 1 })
    expect(messages[0].calls.acked).toBe(false)
    expect(messages[0].calls.retried).toBe(true)
    expect(messages[1].calls.acked).toBe(true)
    expect(messages[1].calls.retried).toBe(false)
  })
})

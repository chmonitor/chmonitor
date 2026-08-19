// @ts-nocheck — bun:test fixture; PersistedClient's dehydrated query state is wider than this stub
/**
 * WHY: once localStorage is over quota the persister would drop the entire
 * write for that tick (and every later tick) unless retry evicts something.
 * These tests drive the shipped PersistRetryer with a real PersistedClient
 * shape so a "drop the largest query" regression fails here.
 */

import type { PersistedClient } from '@tanstack/react-query-persist-client'

import {
  PERSIST_RETRY_MAX_ERROR_COUNT,
  retryPersistOnQuotaOverflow,
} from '../persist-retry'
import { describe, expect, test } from 'bun:test'

function persisted(
  queries: Array<{
    key: string
    data: unknown
    dataUpdatedAt?: number
  }>
): PersistedClient {
  return {
    timestamp: 1,
    buster: 'test',
    clientState: {
      mutations: [],
      queries: queries.map((q) => ({
        queryHash: JSON.stringify([q.key]),
        queryKey: [q.key],
        state: {
          data: q.data,
          dataUpdatedAt: q.dataUpdatedAt ?? 1,
          status: 'success' as const,
        },
      })),
    },
  } as PersistedClient
}

function quotaError(message = 'QuotaExceededError'): Error {
  const err = new Error(message)
  err.name = 'QuotaExceededError'
  return err
}

function queryKeys(client: PersistedClient | undefined): string[] {
  return (client?.clientState.queries ?? []).map((q) => String(q.queryKey[0]))
}

describe('retryPersistOnQuotaOverflow', () => {
  test('evicts the largest query by JSON size of state.data and retries', () => {
    const client = persisted([
      { key: 'small', data: { n: 1 } },
      { key: 'medium', data: { n: 'x'.repeat(80) } },
      { key: 'large', data: { n: 'y'.repeat(8_000) } },
    ])

    const next = retryPersistOnQuotaOverflow({
      persistedClient: client,
      error: quotaError(),
      errorCount: 1,
    })

    expect(next).toBeDefined()
    expect(next).not.toBe(client)
    expect(queryKeys(next)).toEqual(['small', 'medium'])
    expect(queryKeys(next)).not.toContain('large')
  })

  test('treats a QuotaExceededError message (any name) as quota overflow', () => {
    const err = new Error(
      "Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota."
    )
    err.name = 'Error'
    const next = retryPersistOnQuotaOverflow({
      persistedClient: persisted([
        { key: 'keep', data: 1 },
        { key: 'drop', data: { blob: 'z'.repeat(4_000) } },
      ]),
      error: err,
      errorCount: 1,
    })
    expect(queryKeys(next)).toEqual(['keep'])
  })

  test('returns undefined for a non-quota error so persist aborts', () => {
    const next = retryPersistOnQuotaOverflow({
      persistedClient: persisted([{ key: 'a', data: { n: 1 } }]),
      error: new Error('disk is read-only'),
      errorCount: 1,
    })
    expect(next).toBeUndefined()
  })

  test('returns undefined when no queries are left to evict', () => {
    const next = retryPersistOnQuotaOverflow({
      persistedClient: persisted([]),
      error: quotaError(),
      errorCount: 1,
    })
    expect(next).toBeUndefined()
  })

  test('returns undefined after the max retry count so persist aborts', () => {
    const next = retryPersistOnQuotaOverflow({
      persistedClient: persisted([{ key: 'a', data: { n: 1 } }]),
      error: quotaError(),
      errorCount: PERSIST_RETRY_MAX_ERROR_COUNT + 1,
    })
    expect(next).toBeUndefined()
  })

  test('when sizes tie, evicts the oldest query', () => {
    const payload = { n: 'same-size' }
    const next = retryPersistOnQuotaOverflow({
      persistedClient: persisted([
        { key: 'newer', data: payload, dataUpdatedAt: 200 },
        { key: 'older', data: payload, dataUpdatedAt: 50 },
      ]),
      error: quotaError(),
      errorCount: 1,
    })
    expect(queryKeys(next)).toEqual(['newer'])
  })
})

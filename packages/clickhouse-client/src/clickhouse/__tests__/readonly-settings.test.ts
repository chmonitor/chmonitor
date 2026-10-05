import {
  normalizeReadonlySettings,
  READONLY_MODE,
  withReadonlyEnforcement,
} from '../readonly-settings'
import { describe, expect, it, mock } from 'bun:test'

/**
 * Issue #3680. A request that carries `readonly` must never also carry a
 * per-query setting while the server is at read-only level 1: ClickHouse
 * answers Code 164 `Cannot modify '<setting>' setting in readonly mode` and
 * the query never runs. Level 2 keeps the read-only guarantee (no writes, no
 * DDL) and permits the per-query settings the dashboard depends on.
 */
describe('normalizeReadonlySettings', () => {
  it('upgrades an explicit readonly level 1 to level 2', () => {
    expect(normalizeReadonlySettings({ readonly: 1 })).toEqual({
      readonly: READONLY_MODE,
    })
    expect(normalizeReadonlySettings({ readonly: '1' })).toEqual({
      readonly: READONLY_MODE,
    })
  })

  it('leaves a query with no readonly flag untouched', () => {
    const settings = { max_execution_time: 60 }
    expect(normalizeReadonlySettings(settings)).toEqual(settings)
  })

  it('leaves an already-correct readonly level 2 untouched', () => {
    expect(normalizeReadonlySettings({ readonly: 2 })).toEqual({ readonly: 2 })
    expect(normalizeReadonlySettings({ readonly: '2' })).toEqual({
      readonly: '2',
    })
  })

  it('leaves readonly 0 (explicitly not read-only) untouched', () => {
    expect(normalizeReadonlySettings({ readonly: 0 })).toEqual({ readonly: 0 })
  })

  it('is the regression: read-only mode plus any setting must not emit readonly=1', () => {
    const normalized = normalizeReadonlySettings({
      readonly: '1',
      max_execution_time: 60,
    })

    expect(normalized.readonly).not.toBe(1)
    expect(normalized.readonly).not.toBe('1')
    // The setting survives — the query must still be able to time itself out.
    expect(normalized.max_execution_time).toBe(60)
  })

  it('does not mutate its input', () => {
    const input = { readonly: '1' as string | number, max_threads: 2 }
    normalizeReadonlySettings(input)
    expect(input.readonly).toBe('1')
  })

  it('handles a missing settings object', () => {
    expect(normalizeReadonlySettings(undefined)).toBeUndefined()
  })
})

describe('withReadonlyEnforcement', () => {
  /**
   * Returns the client plus handles on the ORIGINAL `query`/`command` mocks.
   * `withReadonlyEnforcement` shadows those properties on the client, so the
   * handles must be taken before wrapping to observe what reached the wire.
   */
  function fakeClient() {
    const query = mock((params: unknown) => ({ params }))
    const command = mock((params: unknown) => ({ params }))
    return {
      client: { query, command, close: () => 'closed' },
      query,
      command,
    }
  }

  it('normalizes clickhouse_settings on query()', () => {
    const { client, query } = fakeClient()
    const wrapped = withReadonlyEnforcement(client as never)

    wrapped.query({
      query: 'SELECT 1',
      clickhouse_settings: { readonly: '1', max_execution_time: 60 },
    })

    const params = query.mock.calls[0][0] as {
      clickhouse_settings: Record<string, unknown>
    }
    expect(params.clickhouse_settings.readonly).toBe(READONLY_MODE)
    expect(params.clickhouse_settings.max_execution_time).toBe(60)
  })

  it('normalizes clickhouse_settings on command()', () => {
    const { client, command } = fakeClient()
    const wrapped = withReadonlyEnforcement(client as never)

    wrapped.command({
      query: 'SELECT 1',
      clickhouse_settings: { readonly: 1, max_threads: 2 },
    })

    const params = command.mock.calls[0][0] as {
      clickhouse_settings: Record<string, unknown>
    }
    expect(params.clickhouse_settings.readonly).toBe(READONLY_MODE)
    expect(params.clickhouse_settings.max_threads).toBe(2)
  })

  it('passes a query with no settings through unchanged', () => {
    const { client, query } = fakeClient()
    const wrapped = withReadonlyEnforcement(client as never)
    const params = { query: 'SELECT 1' }

    wrapped.query(params)

    expect(query.mock.calls[0][0]).toBe(params)
  })

  it('still exposes the underlying client methods', () => {
    const { client } = fakeClient()
    const wrapped = withReadonlyEnforcement(client as never) as unknown as {
      close: () => string
    }

    expect(wrapped.close()).toBe('closed')
  })

  it('returns the same client instance so pooling and releaseClient still work', () => {
    // getClient() hands this instance to callers, the pool, and
    // releaseClient(). Wrapping instead of mutating would split identity.
    const { client } = fakeClient()
    expect(withReadonlyEnforcement(client as never)).toBe(client)
  })

  it('enforces the rule on every query, not just the first', () => {
    const { client, query } = fakeClient()
    const wrapped = withReadonlyEnforcement(client as never)

    wrapped.query({ clickhouse_settings: { readonly: 1 } })
    wrapped.query({
      clickhouse_settings: { readonly: '1', max_result_rows: 5 },
    })

    for (const call of query.mock.calls) {
      const params = call[0] as {
        clickhouse_settings: Record<string, unknown>
      }
      expect(params.clickhouse_settings.readonly).toBe(READONLY_MODE)
    }
  })
})

/**
 * Issue-body formatting, GitHub create/search, and the dedup + rate-cap
 * orchestration for the Cloudflare exception scan.
 */

import type { WorkerException } from './observability'

import {
  buildExceptionIssue,
  type KVLike,
  parseRepo,
  runExceptionScan,
} from './exceptions'
import { describe, expect, mock, test } from 'bun:test'

function exc(over: Partial<WorkerException> = {}): WorkerException {
  return {
    fingerprint: over.fingerprint ?? 'deadbeef',
    message: over.message ?? 'TypeError: x is undefined',
    script: over.script ?? 'chmonitor-dash',
    count: over.count ?? 3,
    firstSeen: over.firstSeen ?? 1_700_000_000_000,
    lastSeen: over.lastSeen ?? 1_700_000_100_000,
  }
}

function makeKV(initial?: Record<string, string>): KVLike & {
  store: Map<string, string>
} {
  const store = new Map(Object.entries(initial ?? {}))
  return {
    store,
    async get(k) {
      return store.get(k) ?? null
    },
    async put(k, v) {
      store.set(k, v)
    },
  }
}

describe('parseRepo', () => {
  test('owner/repo', () => {
    expect(parseRepo('chmonitor/chmonitor')).toEqual({
      owner: 'chmonitor',
      repo: 'chmonitor',
    })
  })
  test('bad input → null', () => {
    expect(parseRepo('nope')).toBeNull()
    expect(parseRepo('')).toBeNull()
  })
})

describe('buildExceptionIssue', () => {
  test('agent-friendly body carries script, fingerprint, count, labels', () => {
    const issue = buildExceptionIssue(exc(), ['bug', 'cloudflare-exception'])
    expect(issue.title).toBe(
      '[cloudflare] chmonitor-dash: TypeError: x is undefined'
    )
    expect(issue.labels).toEqual(['bug', 'cloudflare-exception'])
    expect(issue.body).toContain('`deadbeef`')
    expect(issue.body).toContain('| Occurrences (window) | 3 |')
    expect(issue.body).toContain('For the coding agent')
  })

  test('over-long title is truncated with ellipsis', () => {
    const issue = buildExceptionIssue(exc({ message: 'x'.repeat(400) }), [
      'bug',
    ])
    expect(issue.title.length).toBeLessThanOrEqual(256)
    expect(issue.title.endsWith('…')).toBe(true)
  })
})

const repo = { owner: 'chmonitor', repo: 'chmonitor' }

describe('runExceptionScan — dedup', () => {
  test('KV-known fingerprint is skipped, no issue created', async () => {
    const kv = makeKV({ 'exc-fp:v1:deadbeef': '123' })
    const fetchImpl = mock(async () => new Response('{}', { status: 201 }))
    const notify = mock(async () => true)
    const res = await runExceptionScan({
      repo,
      githubToken: 't',
      fetchExceptions: async () => [exc()],
      kv,
      notify,
      fetch: fetchImpl,
    })
    expect(res.filed).toEqual([])
    expect(res.skipped).toEqual(['deadbeef'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('GitHub search fallback skips a KV-miss + backfills KV', async () => {
    const kv = makeKV()
    // First call = search (found); no create should follow.
    const fetchImpl = mock(async (url: string) => {
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ total_count: 1 }), { status: 200 })
      }
      return new Response('{}', { status: 201 })
    })
    const notify = mock(async () => true)
    const res = await runExceptionScan({
      repo,
      githubToken: 't',
      fetchExceptions: async () => [exc()],
      kv,
      notify,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    expect(res.filed).toEqual([])
    expect(res.skipped).toEqual(['deadbeef'])
    expect(kv.store.get('exc-fp:v1:deadbeef')).toBeDefined()
    expect(notify).not.toHaveBeenCalled()
  })

  test('a NEW fingerprint is filed, KV recorded, telegram notified', async () => {
    const kv = makeKV()
    const calls: string[] = []
    const fetchImpl = mock(async (url: string) => {
      calls.push(url)
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ total_count: 0 }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ html_url: 'https://github.com/x/y/issues/1' }),
        { status: 201 }
      )
    })
    const notify = mock(async () => true)
    const res = await runExceptionScan({
      repo,
      githubToken: 't',
      fetchExceptions: async () => [exc()],
      kv,
      notify,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    expect(res.filed).toEqual(['deadbeef'])
    expect(kv.store.get('exc-fp:v1:deadbeef')).toBeDefined()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(calls.some((u) => u.endsWith('/issues'))).toBe(true)
  })
})

describe('runExceptionScan — rate cap', () => {
  test('files at most maxIssuesPerRun and reports the cap', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      exc({
        fingerprint: `fp${i}`,
        message: `boom ${String.fromCharCode(97 + i)}`,
      })
    )
    const fetchImpl = mock(async (url: string) => {
      if (url.includes('/search/issues')) {
        return new Response(JSON.stringify({ total_count: 0 }), { status: 200 })
      }
      return new Response(JSON.stringify({ html_url: 'u' }), { status: 201 })
    })
    const notify = mock(async () => true)
    const res = await runExceptionScan({
      repo,
      githubToken: 't',
      fetchExceptions: async () => many,
      kv: null,
      maxIssuesPerRun: 2,
      notify,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    expect(res.filed).toHaveLength(2)
    expect(res.cappedAt).toBe(2)
  })
})

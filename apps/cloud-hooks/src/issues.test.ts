/**
 * New-issue watch — seeding, the created_at re-filter, exclusion, and capping.
 */

import type { KVLike } from './github-app'
import type { GitHubIssue } from './issues'

import {
  formatIssue,
  ISSUE_CURSOR_KEY,
  runIssueWatch,
  selectNewIssues,
} from './issues'
import { describe, expect, mock, test } from 'bun:test'

const REPO = { owner: 'chmonitor', repo: 'chmonitor' }
const CURSOR = '2026-07-24T00:00:00.000Z'
const NOW = Date.parse('2026-07-24T12:00:00.000Z')

function issue(over: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: 'Something is broken',
    html_url: 'https://github.com/chmonitor/chmonitor/issues/1',
    created_at: '2026-07-24T06:00:00.000Z',
    user: { login: 'someone' },
    labels: [],
    ...over,
  }
}

/** In-memory KV with the two methods the watch uses. */
function memKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
  } satisfies KVLike & { store: Map<string, string> }
}

function jsonFetch(issues: GitHubIssue[]) {
  return mock(async () => new Response(JSON.stringify(issues), { status: 200 }))
}

describe('selectNewIssues', () => {
  test('drops pull requests — the issues API returns them too', () => {
    const got = selectNewIssues(
      [issue({ number: 2, pull_request: { url: 'x' } }), issue({ number: 3 })],
      CURSOR
    )
    expect(got.map((i) => i.number)).toEqual([3])
  })

  test('drops issues merely UPDATED since the cursor, not created', () => {
    // GitHub's `since` filters on updated_at, so a comment on an old issue
    // comes back in the response. It is not a new issue.
    const old = issue({ number: 4, created_at: '2024-01-01T00:00:00.000Z' })
    expect(selectNewIssues([old], CURSOR)).toEqual([])
  })

  test('drops issues carrying an excluded label (already announced elsewhere)', () => {
    const exc = issue({
      number: 5,
      labels: [{ name: 'bug' }, { name: 'cloudflare-exception' }],
    })
    expect(selectNewIssues([exc], CURSOR)).toEqual([])
    // …and keeps it when the exclusion list is empty.
    expect(selectNewIssues([exc], CURSOR, [])).toHaveLength(1)
  })

  test('accepts labels in GitHub’s string form as well as objects', () => {
    const strLabels = issue({
      number: 6,
      labels: ['cloudflare-exception'],
    }) as GitHubIssue
    expect(selectNewIssues([strLabels], CURSOR)).toEqual([])
  })

  test('returns oldest first so the chat reads chronologically', () => {
    const got = selectNewIssues(
      [
        issue({ number: 7, created_at: '2026-07-24T09:00:00.000Z' }),
        issue({ number: 8, created_at: '2026-07-24T02:00:00.000Z' }),
      ],
      CURSOR
    )
    expect(got.map((i) => i.number)).toEqual([8, 7])
  })
})

describe('runIssueWatch', () => {
  test('first run seeds the cursor and announces nothing', async () => {
    const kv = memKv()
    const notify = mock(async () => true)
    const fetchImpl = jsonFetch([issue()])

    const res = await runIssueWatch({
      repo: REPO,
      githubToken: 't',
      kv,
      notify,
      fetch: fetchImpl,
      now: () => NOW,
    })

    expect(res.seeded).toBe(true)
    expect(notify).not.toHaveBeenCalled()
    // Enabling the watch on a repo with a long backlog must not flood the chat.
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(kv.store.get(ISSUE_CURSOR_KEY)).toBe(new Date(NOW).toISOString())
  })

  test('announces each new issue and advances the cursor to the newest', async () => {
    const kv = memKv({ [ISSUE_CURSOR_KEY]: CURSOR })
    const notify = mock(async () => true)
    const sent: string[] = []

    const res = await runIssueWatch({
      repo: REPO,
      githubToken: 't',
      kv,
      notify: async (_kind, text) => {
        sent.push(text)
        return notify()
      },
      fetch: jsonFetch([
        issue({ number: 11, created_at: '2026-07-24T03:00:00.000Z' }),
        issue({ number: 12, created_at: '2026-07-24T05:00:00.000Z' }),
      ]),
      now: () => NOW,
    })

    expect(res.notified).toEqual([11, 12])
    expect(sent).toHaveLength(2)
    expect(kv.store.get(ISSUE_CURSOR_KEY)).toBe('2026-07-24T05:00:00.000Z')
  })

  test('a capped run defers the rest instead of skipping them', async () => {
    const kv = memKv({ [ISSUE_CURSOR_KEY]: CURSOR })
    const res = await runIssueWatch({
      repo: REPO,
      githubToken: 't',
      kv,
      maxPerRun: 2,
      notify: async () => true,
      fetch: jsonFetch([
        issue({ number: 21, created_at: '2026-07-24T01:00:00.000Z' }),
        issue({ number: 22, created_at: '2026-07-24T02:00:00.000Z' }),
        issue({ number: 23, created_at: '2026-07-24T03:00:00.000Z' }),
      ]),
      now: () => NOW,
    })

    expect(res.notified).toEqual([21, 22])
    expect(res.deferred).toBe(1)
    // The cursor stops at the last ANNOUNCED issue, so #23 is picked up next
    // run rather than being lost forever.
    expect(kv.store.get(ISSUE_CURSOR_KEY)).toBe('2026-07-24T02:00:00.000Z')
  })

  test('leaves the cursor untouched when the GitHub call fails', async () => {
    const kv = memKv({ [ISSUE_CURSOR_KEY]: CURSOR })
    const res = await runIssueWatch({
      repo: REPO,
      githubToken: 't',
      kv,
      notify: async () => true,
      fetch: mock(async () => new Response('bad creds', { status: 401 })),
      now: () => NOW,
      logError: () => {},
    })

    expect(res.notified).toEqual([])
    // Same window is retried next run — a transient failure loses nothing.
    expect(kv.store.get(ISSUE_CURSOR_KEY)).toBe(CURSOR)
  })

  test('skips entirely without KV, since a watch with no memory repeats itself', async () => {
    const notify = mock(async () => true)
    const res = await runIssueWatch({
      repo: REPO,
      githubToken: 't',
      kv: null,
      notify,
      fetch: jsonFetch([issue()]),
      now: () => NOW,
      logError: () => {},
    })
    expect(res).toEqual({ notified: [], seeded: false })
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('formatIssue', () => {
  test('includes number, title, author, labels and url', () => {
    const text = formatIssue(
      issue({ number: 42, labels: [{ name: 'bug' }] }),
      REPO
    )
    expect(text).toContain('#42')
    expect(text).toContain('Something is broken')
    expect(text).toContain('@someone')
    expect(text).toContain('bug')
    expect(text).toContain('https://github.com/chmonitor/chmonitor/issues/1')
  })

  test('escapes HTML so a crafted title cannot break the message', () => {
    // Telegram parses the message as HTML; an unescaped <b> in a title would
    // corrupt the message or get it rejected outright.
    const text = formatIssue(
      issue({ title: 'crash in <Chart> & <b>bold' }),
      REPO
    )
    expect(text).toContain('&lt;Chart&gt; &amp; &lt;b&gt;bold')
  })
})

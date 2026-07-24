/**
 * New GitHub issues → Telegram.
 *
 * On the ops cron, `runIssueWatch` lists issues created since a KV cursor
 * (`issue-watch:v1:last-created`) and announces each one. Unlike the exception
 * scan this files nothing — it is a read-only watch so a community bug report
 * reaches the operator without them polling the repo.
 *
 * Three details that matter:
 *
 * 1. **First run seeds, it does not flood.** With no cursor we record "now" and
 *    announce nothing. Otherwise enabling the watch on a repo with hundreds of
 *    open issues would dump all of them into the chat.
 * 2. **The GitHub `since` filter is on `updated_at`, not `created_at`.** An old
 *    issue that someone comments on comes back in the response, so we re-filter
 *    on `created_at` locally. Without that, every comment on a 2024 issue would
 *    read as "new issue".
 * 3. **Capping is deferral, not loss.** When more issues arrive than the per-run
 *    cap, we take the OLDEST ones and advance the cursor only past those, so the
 *    remainder are announced on the next run instead of being skipped forever.
 *
 * Nothing throws: any failure logs and leaves the cursor untouched, so the next
 * run retries the same window.
 */

import type { GitHubRepo } from './exceptions'
import type { GitHubAppAuth, KVLike } from './github-app'
import type { NotifyKind } from './telegram'

import { withTokenRefresh } from './github-app'

export const ISSUE_NOTIFY_KIND: NotifyKind = 'new_issue'
export const ISSUE_CURSOR_KEY = 'issue-watch:v1:last-created'
const DEFAULT_MAX_PER_RUN = 10
/**
 * Labels whose issues are announced elsewhere. The exception scan already sends
 * its own Telegram message when it files an issue, so without this the operator
 * gets two notifications for the same event.
 */
export const DEFAULT_EXCLUDE_LABELS = ['cloudflare-exception']

export interface GitHubIssue {
  number: number
  title: string
  html_url: string
  created_at: string
  state?: string
  user?: { login?: string } | null
  labels?: Array<{ name?: string } | string> | null
  /** Present only on pull requests — the issues API returns PRs too. */
  pull_request?: unknown
}

export interface FetchIssuesResult {
  status: number
  issues: GitHubIssue[]
  error?: string
}

/** Normalize GitHub's label union (string | {name}) to plain names. */
export function labelNames(issue: GitHubIssue): string[] {
  return (issue.labels ?? [])
    .map((l) => (typeof l === 'string' ? l : (l?.name ?? '')))
    .filter(Boolean)
}

/** List issues updated since `sinceIso`. Never throws. */
export async function fetchIssuesSince(
  repo: GitHubRepo,
  token: string,
  sinceIso: string,
  fetchImpl: typeof fetch = fetch,
  apiBase = 'https://api.github.com',
  perPage = 50
): Promise<FetchIssuesResult> {
  const url =
    `${apiBase}/repos/${repo.owner}/${repo.repo}/issues` +
    `?state=all&sort=created&direction=desc&per_page=${perPage}` +
    `&since=${encodeURIComponent(sinceIso)}`
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'chmonitor-hooks',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch (err) {
    return {
      status: 0,
      issues: [],
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!res.ok) {
    let text = ''
    try {
      text = await res.text()
    } catch {
      /* ignore */
    }
    return { status: res.status, issues: [], error: text }
  }
  try {
    const data = (await res.json()) as GitHubIssue[]
    return { status: res.status, issues: Array.isArray(data) ? data : [] }
  } catch (err) {
    return {
      status: res.status,
      issues: [],
      error: `bad json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Issue counts for a period — the weekly report's Issues section. */
export interface IssueStats {
  opened: number
  closed: number
}

/** Run one GitHub issue search and return its `total_count`, or null. */
async function searchCount(
  query: string,
  token: string,
  fetchImpl: typeof fetch,
  apiBase: string
): Promise<number | null> {
  const url = `${apiBase}/search/issues?q=${encodeURIComponent(query)}&per_page=1`
  try {
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'chmonitor-hooks',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { total_count?: number }
    return typeof data.total_count === 'number' ? data.total_count : null
  } catch {
    return null
  }
}

/**
 * Issues opened and closed since `sinceDay` ('YYYY-MM-DD'). Uses the search API
 * so we pay two requests instead of paging the issue list. Best-effort: any
 * failure returns null and the weekly report omits the Issues section.
 *
 * `is:issue` excludes pull requests, which GitHub otherwise counts as issues.
 */
export async function fetchIssueStats(
  repo: GitHubRepo,
  token: string,
  sinceDay: string,
  fetchImpl: typeof fetch = fetch,
  apiBase = 'https://api.github.com'
): Promise<IssueStats | null> {
  const scope = `repo:${repo.owner}/${repo.repo} is:issue`
  const [opened, closed] = await Promise.all([
    searchCount(`${scope} created:>=${sinceDay}`, token, fetchImpl, apiBase),
    searchCount(`${scope} closed:>=${sinceDay}`, token, fetchImpl, apiBase),
  ])
  if (opened === null && closed === null) return null
  return { opened: opened ?? 0, closed: closed ?? 0 }
}

/**
 * Keep only genuinely new, announceable issues, oldest first. Pure, so the
 * filtering rules (see the module header) are testable without the network.
 */
export function selectNewIssues(
  issues: GitHubIssue[],
  cursorIso: string,
  excludeLabels: string[] = DEFAULT_EXCLUDE_LABELS
): GitHubIssue[] {
  const cursorMs = Date.parse(cursorIso)
  const excluded = new Set(excludeLabels.map((l) => l.toLowerCase()))
  return issues
    .filter((issue) => {
      if (issue.pull_request) return false // the issues API includes PRs
      const created = Date.parse(issue.created_at)
      if (!Number.isFinite(created) || created <= cursorMs) return false
      if (excluded.size === 0) return true
      return !labelNames(issue).some((n) => excluded.has(n.toLowerCase()))
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}

/** Escape the HTML-significant characters in Telegram's HTML parse mode. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The Telegram message for one new issue. */
export function formatIssue(issue: GitHubIssue, repo: GitHubRepo): string {
  const labels = labelNames(issue)
  const parts = [
    `\u{1F195} <b>New issue</b> #${issue.number} in <code>${repo.owner}/${repo.repo}</code>`,
    escapeHtml(issue.title),
  ]
  const meta: string[] = []
  if (issue.user?.login) meta.push(`by @${escapeHtml(issue.user.login)}`)
  if (labels.length > 0) meta.push(labels.map(escapeHtml).join(', '))
  if (meta.length > 0) parts.push(`<i>${meta.join(' · ')}</i>`)
  parts.push(issue.html_url)
  return parts.join('\n')
}

export interface RunIssueWatchDeps {
  repo: GitHubRepo
  githubToken: string
  /** App auth, used to refresh the token once on a 401. Omit for PAT auth. */
  auth?: GitHubAppAuth | null
  kv?: KVLike | null
  excludeLabels?: string[]
  maxPerRun?: number
  notify: (kind: NotifyKind, text: string) => Promise<boolean>
  fetch?: typeof fetch
  githubApiBase?: string
  now?: () => number
  logError?: (message: string, meta?: unknown) => void
}

export interface IssueWatchResult {
  /** Issue numbers announced this run. */
  notified: number[]
  /** True when this run only recorded a starting cursor. */
  seeded: boolean
  /** Set when the per-run cap deferred issues to the next run. */
  deferred?: number
}

/**
 * Announce issues created since the stored cursor. Idempotent across runs via
 * the KV cursor; without KV it can only seed (and logs why), because a watch
 * with no memory would re-announce the same issues every 15 minutes.
 */
export async function runIssueWatch(
  deps: RunIssueWatchDeps
): Promise<IssueWatchResult> {
  const fetchImpl = deps.fetch ?? fetch
  const apiBase = deps.githubApiBase ?? 'https://api.github.com'
  const cap = deps.maxPerRun ?? DEFAULT_MAX_PER_RUN
  const now = deps.now ?? Date.now
  const logError = deps.logError ?? ((m, meta) => console.error(m, meta))
  const nowIso = new Date(now()).toISOString()

  if (!deps.kv) {
    logError(
      '[cloud-hooks] issue watch needs CHM_HOOKS_KV for its cursor; skipping'
    )
    return { notified: [], seeded: false }
  }

  let cursor: string | null = null
  try {
    cursor = await deps.kv.get(ISSUE_CURSOR_KEY)
  } catch (err) {
    logError('[cloud-hooks] issue cursor read failed', err)
    return { notified: [], seeded: false }
  }

  // First run: remember where we started, announce nothing (see header).
  if (!cursor) {
    try {
      await deps.kv.put(ISSUE_CURSOR_KEY, nowIso)
    } catch (err) {
      logError('[cloud-hooks] issue cursor seed failed', err)
    }
    console.log(`[cloud-hooks] issue watch seeded at ${nowIso}`)
    return { notified: [], seeded: true }
  }

  const result = await withTokenRefresh(
    deps.auth ?? null,
    (token) =>
      fetchIssuesSince(deps.repo, token, cursor as string, fetchImpl, apiBase),
    deps.githubToken
  )
  if (result.error || result.status === 0) {
    logError('[cloud-hooks] issue list failed', {
      status: result.status,
      error: result.error,
    })
    return { notified: [], seeded: false }
  }

  const fresh = selectNewIssues(
    result.issues,
    cursor,
    deps.excludeLabels ?? DEFAULT_EXCLUDE_LABELS
  )
  if (fresh.length === 0) return { notified: [], seeded: false }

  // Oldest-first up to the cap; the cursor advances only past what we announce.
  const batch = fresh.slice(0, cap)
  const notified: number[] = []
  for (const issue of batch) {
    await deps.notify(ISSUE_NOTIFY_KIND, formatIssue(issue, deps.repo))
    notified.push(issue.number)
  }

  const newest = batch[batch.length - 1]?.created_at
  if (newest) {
    try {
      await deps.kv.put(ISSUE_CURSOR_KEY, newest)
    } catch (err) {
      // Leave the cursor alone — the next run re-announces at worst.
      logError('[cloud-hooks] issue cursor write failed', err)
    }
  }

  const deferred = fresh.length - batch.length
  return {
    notified,
    seeded: false,
    ...(deferred > 0 ? { deferred } : {}),
  }
}

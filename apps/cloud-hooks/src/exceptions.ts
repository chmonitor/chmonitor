/**
 * Cloudflare Worker exceptions → GitHub issues.
 *
 * On the ops cron, `runExceptionScan`:
 *   1. pulls recent exception fingerprints (see `observability.ts`),
 *   2. deduplicates them against KV memory (`exc-fp:v1:<fp>`) AND a GitHub
 *      search fallback (so a KV miss never re-files a known error),
 *   3. rate-caps issue creation (default 5/run),
 *   4. files an agent-friendly GitHub issue per NEW fingerprint (mirroring
 *      `apps/bug-handler`'s template) and sends a Telegram notify.
 *
 * Every collaborator is injected and nothing throws — a missing credential
 * disables the capability upstream (in `index.ts`), and any per-error failure is
 * logged and skipped rather than crashing the cron.
 */

import type { GitHubAppAuth, KVLike } from './github-app'
import type { WorkerException } from './observability'
import type { NotifyKind } from './telegram'

import { withTokenRefresh } from './github-app'

export const EXCEPTION_NOTIFY_KIND: NotifyKind = 'error'
const KV_PREFIX = 'exc-fp:v1:'
const DEFAULT_MAX_ISSUES_PER_RUN = 5
const MAX_TITLE_LEN = 256

// ── Spike detection ─────────────────────────────────────────────────────────
// Fingerprint dedup is permanent by design: an error is filed once and never
// re-filed. The blind spot is that a KNOWN error which suddenly fires 100× more
// often is completely silent — it was already filed, so it is skipped. That is
// usually the more urgent event: a latent bug that just became everyone's
// problem. So on every skip we also compare this window's occurrence count
// against the last count we saw for that fingerprint.
const RATE_PREFIX = 'exc-rate:v1:'
/** Below this many occurrences, a multiple is just noise (2 → 6 is not news). */
export const SPIKE_MIN_COUNT = 25
/** How many times the previous count qualifies as a spike. */
export const SPIKE_MULTIPLE = 3
/** Do not re-alert about the same fingerprint spiking within this window. */
export const SPIKE_COOLDOWN_MS = 6 * 60 * 60 * 1000

/** Per-fingerprint spike memory. */
export interface RateRecord {
  count: number
  alertedAt: number
}

/**
 * Is this window's count a spike against the previous one? Pure, so the
 * thresholds are testable without KV. Requires BOTH an absolute floor and a
 * relative jump, and respects a cooldown so one ongoing incident does not
 * re-alert every 15 minutes.
 */
export function isSpike(
  current: number,
  previous: RateRecord | null,
  now: number
): boolean {
  if (current < SPIKE_MIN_COUNT) return false
  // No history: only alert if it is already loud on its own.
  if (!previous) return current >= SPIKE_MIN_COUNT * SPIKE_MULTIPLE
  if (now - previous.alertedAt < SPIKE_COOLDOWN_MS) return false
  if (previous.count <= 0) return current >= SPIKE_MIN_COUNT * SPIKE_MULTIPLE
  return current >= previous.count * SPIKE_MULTIPLE
}

/** The Telegram message for a known error that is suddenly much louder. */
export function formatSpike(
  exc: WorkerException,
  previous: RateRecord | null
): string {
  const was = previous ? ` (was ${previous.count})` : ''
  return [
    `\u{1F4C8} <b>Known error spiking</b> in <code>${exc.script}</code>`,
    `${exc.count} occurrences this window${was}`,
    exc.message,
  ].join('\n')
}

export interface GitHubRepo {
  owner: string
  repo: string
}

export function parseRepo(full: string): GitHubRepo | null {
  const [owner, repo] = full.split('/')
  if (!owner || !repo) return null
  return { owner, repo }
}

export interface IssuePayload {
  title: string
  body: string
  labels: string[]
}

/**
 * Compose the GitHub issue for a Worker exception. Pure — mirrors bug-handler's
 * agent-friendly markdown (Summary, Source table, For the coding agent).
 */
export function buildExceptionIssue(
  exc: WorkerException,
  labels: string[]
): IssuePayload {
  const rawTitle = `[cloudflare] ${exc.script}: ${exc.message}`
  const title =
    rawTitle.length > MAX_TITLE_LEN
      ? `${rawTitle.slice(0, MAX_TITLE_LEN - 1)}…`
      : rawTitle

  const first = new Date(exc.firstSeen).toISOString()
  const last = new Date(exc.lastSeen).toISOString()

  const body = `## Summary

Uncaught exception in Cloudflare Worker \`${exc.script}\`.

## Source

| Field | Value |
| --- | --- |
| Worker script | \`${exc.script}\` |
| Fingerprint | \`${exc.fingerprint}\` |
| Occurrences (window) | ${exc.count} |
| First seen | ${first} |
| Last seen | ${last} |
| Detected by | chmonitor-hooks exception scan |

## Error

\`\`\`
${exc.message}
\`\`\`

## For the coding agent

- [ ] Reproduce the exception locally or in a staging environment.
- [ ] Open Workers Observability for \`${exc.script}\` and inspect the full stack trace (filter \`$metadata.error EXISTS\`).
- [ ] Locate the culprit file / function from the stack trace.
- [ ] Write a failing test that captures the bug (unit or integration).
- [ ] Fix the root cause — patch only what is broken; no unrelated changes.
- [ ] Ensure the new test passes and the suite is green (\`bun test\`).
- [ ] Open a pull request that references this issue (\`Fixes #<issue-number>\`).

---
_Filed automatically by the chmonitor-hooks exception scan. Fingerprint \`${exc.fingerprint}\` — this issue will not be re-filed._`

  return { title, body, labels }
}

export interface IssueResult {
  ok: boolean
  status: number
  url?: string
  error?: string
}

/** POST a new issue to the GitHub REST API. Never throws. */
export async function createGitHubIssue(
  repo: GitHubRepo,
  token: string,
  issue: IssuePayload,
  fetchImpl: typeof fetch = fetch,
  apiBase = 'https://api.github.com'
): Promise<IssueResult> {
  const url = `${apiBase}/repos/${repo.owner}/${repo.repo}/issues`
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'chmonitor-hooks',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      }),
    })
  } catch (err) {
    return {
      ok: false,
      status: 0,
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
    return { ok: false, status: res.status, error: text }
  }
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    status: res.status,
    url: typeof data.html_url === 'string' ? data.html_url : undefined,
  }
}

/**
 * GitHub search fallback: is there already an issue (open OR closed) whose body
 * carries this fingerprint? Guards against re-filing when KV is absent or was
 * evicted. On any error, returns false (fail-open to KV, which we already
 * checked) — a rare duplicate is better than silently dropping a real error.
 */
export async function issueExistsForFingerprint(
  repo: GitHubRepo,
  token: string,
  fingerprint: string,
  fetchImpl: typeof fetch = fetch,
  apiBase = 'https://api.github.com'
): Promise<boolean> {
  const q = `repo:${repo.owner}/${repo.repo} in:body "${fingerprint}"`
  const url = `${apiBase}/search/issues?q=${encodeURIComponent(q)}&per_page=1`
  try {
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'chmonitor-hooks',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return false
    const data = (await res.json()) as { total_count?: number }
    return (data.total_count ?? 0) > 0
  } catch {
    return false
  }
}

export type { KVLike } from './github-app'

export interface RunExceptionScanDeps {
  repo: GitHubRepo
  /** A ready-to-use GitHub token (App installation token or PAT). */
  githubToken: string
  /**
   * When issues are authed as a GitHub App, the token provider used to refresh
   * once on a 401 (installation token revoked/expired early). Omit for PAT auth.
   */
  auth?: GitHubAppAuth | null
  /** Fetch aggregated exception fingerprints (from observability.ts). */
  fetchExceptions: () => Promise<WorkerException[]>
  kv?: KVLike | null
  labels?: string[]
  maxIssuesPerRun?: number
  notify: (kind: NotifyKind, text: string) => Promise<boolean>
  fetch?: typeof fetch
  githubApiBase?: string
  /** Epoch ms, injectable so the spike cooldown is testable. */
  now?: () => number
  logError?: (message: string, meta?: unknown) => void
}

export interface ExceptionScanResult {
  /** Fingerprints for which a new issue was filed this run. */
  filed: string[]
  /** Fingerprints skipped because already known (KV or GitHub search). */
  skipped: string[]
  /** Whether the run hit the per-run rate cap. */
  cappedAt?: number
}

/**
 * Compare a known fingerprint's current occurrence count against the last one
 * we recorded, alert if it spiked, and always store the new count so the
 * baseline tracks reality. Never throws — spike detection is an enhancement,
 * not a reason to fail a scan.
 */
async function checkSpike(
  deps: RunExceptionScanDeps,
  exc: WorkerException,
  now: number,
  logError: (message: string, meta?: unknown) => void
): Promise<void> {
  if (!deps.kv) return
  const key = `${RATE_PREFIX}${exc.fingerprint}`
  let previous: RateRecord | null = null
  try {
    const raw = await deps.kv.get(key)
    if (raw) previous = JSON.parse(raw) as RateRecord
  } catch (err) {
    logError('[cloud-hooks] exception rate read failed', { err })
  }

  const spiking = isSpike(exc.count, previous, now)
  if (spiking) {
    await deps.notify(EXCEPTION_NOTIFY_KIND, formatSpike(exc, previous))
  }

  try {
    await deps.kv.put(
      key,
      JSON.stringify({
        count: exc.count,
        // Only move the cooldown clock when we actually alerted, so a quiet
        // update cannot postpone the next real alert.
        alertedAt: spiking ? now : (previous?.alertedAt ?? 0),
      } satisfies RateRecord)
    )
  } catch (err) {
    logError('[cloud-hooks] exception rate write failed', { err })
  }
}

/**
 * Orchestrate one exception scan. Idempotent per fingerprint: a fingerprint seen
 * in KV, or found by the GitHub search fallback, is never re-filed.
 */
export async function runExceptionScan(
  deps: RunExceptionScanDeps
): Promise<ExceptionScanResult> {
  const fetchImpl = deps.fetch ?? fetch
  const apiBase = deps.githubApiBase ?? 'https://api.github.com'
  const labels = deps.labels ?? ['bug', 'cloudflare-exception']
  const cap = deps.maxIssuesPerRun ?? DEFAULT_MAX_ISSUES_PER_RUN
  const logError = deps.logError ?? ((m, meta) => console.error(m, meta))
  const now = (deps.now ?? Date.now)()

  const filed: string[] = []
  const skipped: string[] = []

  let exceptions: WorkerException[] = []
  try {
    exceptions = await deps.fetchExceptions()
  } catch (err) {
    logError('[cloud-hooks] exception fetch failed', { err })
    return { filed, skipped }
  }

  for (const exc of exceptions) {
    if (filed.length >= cap) {
      return { filed, skipped, cappedAt: cap }
    }

    const kvKey = `${KV_PREFIX}${exc.fingerprint}`

    // 1. KV memory — the fast path.
    if (deps.kv) {
      try {
        if (await deps.kv.get(kvKey)) {
          skipped.push(exc.fingerprint)
          // Known error: no new issue, but check whether it just got much
          // louder — that is the event this scan would otherwise miss entirely.
          await checkSpike(deps, exc, now, logError)
          continue
        }
      } catch (err) {
        logError('[cloud-hooks] exception KV read failed', { err })
      }
    }

    // 2. GitHub search fallback — catches a KV miss/eviction.
    if (
      await issueExistsForFingerprint(
        deps.repo,
        deps.githubToken,
        exc.fingerprint,
        fetchImpl,
        apiBase
      )
    ) {
      skipped.push(exc.fingerprint)
      // Backfill KV so we skip the search next time.
      if (deps.kv) {
        try {
          await deps.kv.put(kvKey, String(exc.lastSeen))
        } catch {
          /* ignore */
        }
      }
      continue
    }

    // 3. File the issue (refreshing App auth once on a 401).
    const issue = buildExceptionIssue(exc, labels)
    const result = await withTokenRefresh(
      deps.auth ?? null,
      (token) => createGitHubIssue(deps.repo, token, issue, fetchImpl, apiBase),
      deps.githubToken
    )
    if (!result.ok) {
      logError('[cloud-hooks] createGitHubIssue failed', {
        fingerprint: exc.fingerprint,
        status: result.status,
        error: result.error,
      })
      continue
    }

    filed.push(exc.fingerprint)
    if (deps.kv) {
      try {
        await deps.kv.put(kvKey, String(exc.lastSeen))
      } catch {
        /* ignore */
      }
    }
    await deps.notify(
      EXCEPTION_NOTIFY_KIND,
      `\u{1F41B} <b>New Worker exception</b> in <code>${exc.script}</code>\n${exc.message}${
        result.url ? `\n${result.url}` : ''
      }`
    )
  }

  return { filed, skipped }
}

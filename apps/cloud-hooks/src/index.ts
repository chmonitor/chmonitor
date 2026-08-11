/**
 * chmonitor cloud-hooks — Cloudflare Worker (Cloud/SaaS only).
 *
 * Routes:
 *   POST /webhooks/polar  → validate signature → shared billing core → Telegram
 *   POST /webhooks/clerk  → verify Svix signature → Clerk lifecycle → Telegram
 *   GET  /healthz         → 200 liveness shell (static, no deps)
 *
 * Scheduled (wrangler.toml [triggers] crons):
 *   "0 0 * * *"       → daily digest (billing + users + DAU/MAU) → Telegram
 *   "0 1 * * 1"       → weekly report (week-over-week trends) → Telegram
 *   every 15 minutes  → ops sweep: health probes, Worker exceptions → GitHub
 *                       issues, and new GitHub issues → Telegram
 *
 * OSS/self-host never deploys this — it is purely additive Cloud plumbing.
 */

import type { Env } from './env'
import type { GitHubRepo } from './exceptions'
import type { GitHubAppAuth } from './github-app'

import { collectActivation } from './activation'
import { detectAnomaly, fetchDailySeries, formatAnomaly } from './anomaly'
import { fetchClerkMetrics, WEEK_SECONDS } from './clerk-metrics'
import { handleClerkWebhook } from './clerk-webhook'
import { parseRepo, runExceptionScan } from './exceptions'
import { resolveGitHubAuth } from './github-app'
import { fetchIssueStats, runIssueWatch } from './issues'
import { fetchWorkerExceptions } from './observability'
import { readProbeSnapshot, runProbes } from './probes'
import { collectSummary, formatDigest } from './summary'
import { Notifier } from './telegram'
import { collectUsage, utcDay } from './usage'
import { handlePolarWebhook } from './webhook'
import { collectWeekly, formatWeekly, weekBounds } from './weekly'

/**
 * Single cron trigger, which MUST match `[triggers] crons` in wrangler.toml.
 *
 * The Workers Free plan allows 5 cron triggers PER ACCOUNT, and the dashboard
 * Worker uses 4 — so this Worker gets exactly one. The every-15-minutes cadence always
 * fires at minute 0, so the daily digest (00:00 UTC tick) and weekly report
 * (Monday 01:00 UTC tick) are dispatched off `event.scheduledTime` instead of
 * separate cron expressions.
 */
export const OPS_SWEEP_CRON = '*/15 * * * *'

/** True on the 00:00 UTC tick — run the daily digest. */
export function isDailyTick(at: Date): boolean {
  return at.getUTCHours() === 0 && at.getUTCMinutes() === 0
}

/** True on the Monday 01:00 UTC tick — run the weekly report. */
export function isWeeklyTick(at: Date): boolean {
  return (
    at.getUTCDay() === 1 && at.getUTCHours() === 1 && at.getUTCMinutes() === 0
  )
}

function notifierFor(env: Env): Notifier {
  return new Notifier({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  })
}

/**
 * Resolve a usable GitHub token once per job. Three capabilities now need one
 * (exception scan, issue watch, weekly issue stats), so the credential checks,
 * repo parsing, and token minting live here instead of being repeated.
 *
 * Returns null — after ONE explanatory log line — whenever GitHub is not
 * configured, so a deploy without these secrets simply runs without the
 * GitHub-backed features.
 */
async function resolveGitHub(
  env: Env,
  label: string
): Promise<{
  repo: GitHubRepo
  token: string
  auth: GitHubAppAuth | null
} | null> {
  const hasAuth = (env.GH_APP_ID && env.GH_APP_PRIVATE_KEY) || env.GITHUB_TOKEN
  if (!hasAuth) {
    console.log(`[cloud-hooks] ${label} disabled (no GitHub credentials)`)
    return null
  }
  const repo = parseRepo(env.GITHUB_REPOSITORY || 'chmonitor/chmonitor')
  if (!repo) {
    console.log(`[cloud-hooks] ${label} disabled (bad GITHUB_REPOSITORY)`)
    return null
  }
  const auth = resolveGitHubAuth(
    env,
    repo.owner,
    repo.repo,
    env.CHM_HOOKS_KV ?? null
  )
  if (auth.mode === 'disabled') {
    console.log(`[cloud-hooks] ${label} disabled (no GitHub credentials)`)
    return null
  }
  try {
    const token =
      auth.mode === 'app' ? await auth.app!.getToken() : (auth.token as string)
    return {
      repo,
      token,
      auth: auth.mode === 'app' ? (auth.app ?? null) : null,
    }
  } catch (err) {
    console.error(
      `[cloud-hooks] ${label}: GitHub token acquisition failed`,
      err
    )
    return null
  }
}

/**
 * Alert when yesterday's active installs diverge sharply from their own recent
 * baseline. Sent as its OWN message rather than a digest line: a collapse in
 * usage means something is broken right now, and a line inside a long digest is
 * easy to miss. Silent when there is no telemetry binding or no anomaly.
 */
async function runUsageAnomaly(
  env: Env,
  notifier: Notifier,
  nowSeconds: number
): Promise<void> {
  const db = env.CHM_TELEMETRY_DB
  if (!db) return
  const referenceDay = utcDay(new Date((nowSeconds - 24 * 60 * 60) * 1000))
  const series = await fetchDailySeries(db, referenceDay)
  if (series.length === 0) return
  const anomaly = detectAnomaly(series, referenceDay)
  if (!anomaly) return
  await notifier.notify('usage_anomaly', formatAnomaly(anomaly))
}

async function runDailySummary(env: Env, notifier: Notifier): Promise<void> {
  if (!env.CHM_CLOUD_D1) {
    console.error('[cloud-hooks] CHM_CLOUD_D1 unbound; skipping daily summary')
    return
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  try {
    // Billing (D1) is the required core; Clerk metrics, usage (DAU/WAU/MAU from
    // the telemetry D1), and the probe snapshot are best-effort enrichments that
    // degrade to omitted sections when absent.
    const [data, clerk, usage, probes] = await Promise.all([
      collectSummary(env.CHM_CLOUD_D1, nowSeconds),
      fetchClerkMetrics(env.CLERK_SECRET_KEY, fetch, nowSeconds),
      collectUsage(env.CHM_TELEMETRY_DB ?? null, nowSeconds),
      readProbeSnapshot(env.CHM_HOOKS_KV ?? null),
    ])
    // Activation needs the signup count, so it runs after Clerk answers.
    const activation = await collectActivation(
      env.CHM_CLOUD_D1,
      nowSeconds - 24 * 60 * 60,
      clerk?.newUsers ?? null
    )
    await notifier.notify(
      'daily_summary',
      formatDigest(data, { clerk, usage, activation, probes })
    )
  } catch (err) {
    console.error('[cloud-hooks] daily summary failed', err)
  }

  // Separate from the digest's try/catch: a failed digest must not swallow the
  // anomaly alert, which is the more urgent of the two.
  try {
    await runUsageAnomaly(env, notifier, nowSeconds)
  } catch (err) {
    console.error('[cloud-hooks] usage anomaly check failed', err)
  }
}

/**
 * Weekly report — the same surfaces as the daily digest but week-over-week, plus
 * issue throughput. Billing (D1) is required; every other section degrades to
 * omitted, so this still sends something useful on a partially-configured
 * deployment.
 */
async function runWeeklyReport(env: Env, notifier: Notifier): Promise<void> {
  if (!env.CHM_CLOUD_D1) {
    console.error('[cloud-hooks] CHM_CLOUD_D1 unbound; skipping weekly report')
    return
  }
  try {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const { start } = weekBounds(nowSeconds)
    const sinceDay = new Date(start * 1000).toISOString().slice(0, 10)

    const [data, clerk, usage, probes, issues] = await Promise.all([
      collectWeekly(env.CHM_CLOUD_D1, nowSeconds),
      // A 7-day window here, so "new users" matches the reported period.
      fetchClerkMetrics(env.CLERK_SECRET_KEY, fetch, nowSeconds, WEEK_SECONDS),
      collectUsage(env.CHM_TELEMETRY_DB ?? null, nowSeconds),
      readProbeSnapshot(env.CHM_HOOKS_KV ?? null),
      resolveGitHub(env, 'weekly issue stats').then((gh) =>
        gh ? fetchIssueStats(gh.repo, gh.token, sinceDay) : null
      ),
    ])
    await notifier.notify(
      'weekly_summary',
      formatWeekly(data, { clerk, usage, probes, issues })
    )
  } catch (err) {
    console.error('[cloud-hooks] weekly report failed', err)
  }
}

/**
 * Announce GitHub issues opened since the last sweep. Read-only — it files
 * nothing, it just makes sure a community bug report reaches the operator.
 */
async function runIssues(env: Env, notifier: Notifier): Promise<void> {
  const gh = await resolveGitHub(env, 'issue watch')
  if (!gh) return

  const maxPerRun = Number.parseInt(env.CHM_ISSUE_WATCH_MAX_PER_RUN || '10', 10)
  const excludeLabels = (
    env.CHM_ISSUE_WATCH_EXCLUDE_LABELS ?? 'cloudflare-exception'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  try {
    await runIssueWatch({
      repo: gh.repo,
      githubToken: gh.token,
      auth: gh.auth,
      kv: env.CHM_HOOKS_KV ?? null,
      excludeLabels,
      maxPerRun: Number.isFinite(maxPerRun) ? maxPerRun : 10,
      notify: (kind, text) => notifier.notify(kind, text),
    })
  } catch (err) {
    console.error('[cloud-hooks] issue watch failed', err)
  }
}

/**
 * Pull recent Cloudflare Worker exceptions and file a GitHub issue per NEW
 * fingerprint. Every required credential missing → one log line and a no-op
 * (never a crash), so an OSS-style deploy without these secrets just skips it.
 */
async function runExceptions(env: Env, notifier: Notifier): Promise<void> {
  // Cloudflare-side credentials are specific to this job; the GitHub side is
  // resolved by the shared helper.
  const missing: string[] = []
  if (!env.CF_OBSERVABILITY_API_TOKEN)
    missing.push('CF_OBSERVABILITY_API_TOKEN')
  if (!env.CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID')
  if (missing.length > 0) {
    console.log(
      `[cloud-hooks] exception scan disabled (missing ${missing.join(', ')})`
    )
    return
  }

  const gh = await resolveGitHub(env, 'exception scan')
  if (!gh) return
  const { repo, token: githubToken, auth } = gh

  const scripts = (
    env.CHM_EXCEPTION_SCRIPTS || 'chmonitor-dash,chmonitor-hooks'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const labels = (env.CHM_EXCEPTION_ISSUE_LABELS || 'bug,cloudflare-exception')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const maxIssues = Number.parseInt(
    env.CHM_EXCEPTION_MAX_ISSUES_PER_RUN || '5',
    10
  )

  try {
    await runExceptionScan({
      repo,
      githubToken,
      auth,
      fetchExceptions: () =>
        fetchWorkerExceptions({
          accountId: env.CF_ACCOUNT_ID as string,
          apiToken: env.CF_OBSERVABILITY_API_TOKEN as string,
          scripts,
        }),
      kv: env.CHM_HOOKS_KV ?? null,
      labels,
      maxIssuesPerRun: Number.isFinite(maxIssues) ? maxIssues : 5,
      notify: (kind, text) => notifier.notify(kind, text),
    })
  } catch (err) {
    console.error('[cloud-hooks] exception scan failed', err)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/healthz') {
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }

    if (url.pathname === '/webhooks/polar') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      const notifier = notifierFor(env)
      return handlePolarWebhook(request, env, {
        notify: (kind, text) => notifier.notify(kind, text),
      })
    }

    if (url.pathname === '/webhooks/clerk') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      const notifier = notifierFor(env)
      return handleClerkWebhook(request, env, {
        notify: (kind, text) => notifier.notify(kind, text),
        kv: env.CHM_HOOKS_KV ?? null,
      })
    }

    return new Response('Not Found', { status: 404 })
  },

  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const notifier = notifierFor(env)
    const at = new Date(event.scheduledTime)

    // One cron, time-based dispatch (see OPS_SWEEP_CRON): the reports run IN
    // ADDITION to the sweep on their tick, matching the old behavior where the
    // daily/weekly crons fired alongside the every-15-minutes sweep.
    if (isWeeklyTick(at)) {
      ctx.waitUntil(runWeeklyReport(env, notifier))
    } else if (isDailyTick(at)) {
      ctx.waitUntil(runDailySummary(env, notifier))
    }
    // Every tick (and any other trigger) runs the ops sweep: full-surface
    // health probes, the Cloudflare exception → GitHub issue scan, and the
    // new-issue watch.
    ctx.waitUntil(
      runProbes({
        kv: env.CHM_HOOKS_KV ?? null,
        d1: env.CHM_CLOUD_D1 ?? null,
        notify: (kind, text) => notifier.notify(kind, text),
      })
    )
    ctx.waitUntil(runExceptions(env, notifier))
    ctx.waitUntil(runIssues(env, notifier))
  },
}

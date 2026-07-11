/**
 * chmonitor cloud-hooks — Cloudflare Worker (Cloud/SaaS only).
 *
 * Routes:
 *   POST /webhooks/polar  → validate signature → shared billing core → Telegram
 *   GET  /healthz         → 200 liveness shell (static, no deps)
 *
 * Scheduled (wrangler.toml [triggers] crons):
 *   "0 0 * * *"       → daily billing summary → Telegram
 *   every 15 minutes  → health probes (dash/docs/landing) → Telegram on changes
 *
 * OSS/self-host never deploys this — it is purely additive Cloud plumbing.
 */

import type { Env } from './env'

import { parseRepo, runExceptionScan } from './exceptions'
import { resolveGitHubAuth } from './github-app'
import { fetchWorkerExceptions } from './observability'
import { runProbes } from './probes'
import { collectSummary, formatSummary } from './summary'
import { Notifier } from './telegram'
import { handlePolarWebhook } from './webhook'

function notifierFor(env: Env): Notifier {
  return new Notifier({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  })
}

async function runDailySummary(env: Env, notifier: Notifier): Promise<void> {
  if (!env.CHM_CLOUD_D1) {
    console.error('[cloud-hooks] CHM_CLOUD_D1 unbound; skipping daily summary')
    return
  }
  try {
    const data = await collectSummary(env.CHM_CLOUD_D1)
    await notifier.notify('daily_summary', formatSummary(data))
  } catch (err) {
    console.error('[cloud-hooks] daily summary failed', err)
  }
}

/**
 * Pull recent Cloudflare Worker exceptions and file a GitHub issue per NEW
 * fingerprint. Every required credential missing → one log line and a no-op
 * (never a crash), so an OSS-style deploy without these secrets just skips it.
 */
async function runExceptions(env: Env, notifier: Notifier): Promise<void> {
  const missing: string[] = []
  const hasGitHubAuth =
    (env.GH_APP_ID && env.GH_APP_PRIVATE_KEY) || env.GITHUB_TOKEN
  if (!hasGitHubAuth)
    missing.push('GH_APP_ID+GH_APP_PRIVATE_KEY or GITHUB_TOKEN')
  if (!env.CF_OBSERVABILITY_API_TOKEN)
    missing.push('CF_OBSERVABILITY_API_TOKEN')
  if (!env.CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID')
  if (missing.length > 0) {
    console.log(
      `[cloud-hooks] exception scan disabled (missing ${missing.join(', ')})`
    )
    return
  }

  const repo = parseRepo(env.GITHUB_REPOSITORY || 'chmonitor/chmonitor')
  if (!repo) {
    console.log('[cloud-hooks] exception scan disabled (bad GITHUB_REPOSITORY)')
    return
  }

  const auth = resolveGitHubAuth(
    env,
    repo.owner,
    repo.repo,
    env.CHM_HOOKS_KV ?? null
  )
  if (auth.mode === 'disabled') {
    console.log('[cloud-hooks] exception scan disabled (no GitHub credentials)')
    return
  }

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

  let githubToken: string
  try {
    githubToken =
      auth.mode === 'app' ? await auth.app!.getToken() : (auth.token as string)
  } catch (err) {
    console.error('[cloud-hooks] GitHub App token acquisition failed', err)
    return
  }

  try {
    await runExceptionScan({
      repo,
      githubToken,
      auth: auth.mode === 'app' ? auth.app : null,
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

    return new Response('Not Found', { status: 404 })
  },

  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const notifier = notifierFor(env)
    if (event.cron === '0 0 * * *') {
      ctx.waitUntil(runDailySummary(env, notifier))
      return
    }
    // Default the shorter cadence (and any other trigger) to the ops sweep:
    // full-surface health probes + Cloudflare exception → GitHub issue scan.
    ctx.waitUntil(
      runProbes({
        kv: env.CHM_HOOKS_KV ?? null,
        d1: env.CHM_CLOUD_D1 ?? null,
        notify: (kind, text) => notifier.notify(kind, text),
      })
    )
    ctx.waitUntil(runExceptions(env, notifier))
  },
}

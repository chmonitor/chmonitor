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
    // Default the shorter cadence (and any other trigger) to health probes.
    ctx.waitUntil(
      runProbes({
        kv: env.HOOKS_KV ?? null,
        notify: (kind, text) => notifier.notify(kind, text),
      })
    )
  },
}

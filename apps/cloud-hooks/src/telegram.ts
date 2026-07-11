/**
 * Telegram notifications — the raw Bot API over `fetch` (no SDK).
 *
 * Every operator message funnels through one `Notifier.notify(kind, text)`
 * helper. Each `kind` has a minimum interval (per-kind throttle) so a webhook
 * storm — or a flapping health probe — cannot flood the chat. The throttle is
 * in-memory per Worker isolate, which is sufficient for v1: the point is to
 * damp bursts within a single invocation / warm isolate, not to guarantee a
 * global rate limit across isolates.
 *
 * A Telegram failure NEVER throws: `notify` catches, logs, and returns false so
 * a delivery hiccup can never fail a webhook response or a cron job.
 */

export type NotifyKind =
  | 'subscription'
  | 'plan_change'
  | 'cancel'
  | 'payment_failure'
  | 'signature_failure'
  | 'daily_summary'
  | 'probe'
  | 'error'

/** Minimum milliseconds between two messages of the SAME kind. */
export const THROTTLE_MS: Record<NotifyKind, number> = {
  // Revenue events are rare and always worth sending — light throttle only to
  // collapse an at-least-once duplicate delivery burst.
  subscription: 5_000,
  plan_change: 5_000,
  cancel: 5_000,
  payment_failure: 5_000,
  // A misconfigured/spoofing source could hammer bad signatures — damp hard.
  signature_failure: 60_000,
  // Scheduled once a day; the throttle is just a belt-and-braces dedupe.
  daily_summary: 60_000,
  // Health transitions: avoid re-alerting on a flapping target within a window.
  probe: 30_000,
  error: 30_000,
}

export interface TelegramConfig {
  botToken?: string
  chatId?: string
}

export interface NotifierOptions {
  fetch?: typeof fetch
  now?: () => number
  /** Override per-kind throttle windows (tests). */
  throttleMs?: Partial<Record<NotifyKind, number>>
  logError?: (message: string, meta?: unknown) => void
}

export function isTelegramConfigured(cfg: TelegramConfig): boolean {
  return Boolean(cfg.botToken && cfg.chatId)
}

export class Notifier {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly throttle: Record<NotifyKind, number>
  private readonly logError: (message: string, meta?: unknown) => void
  private readonly lastSent = new Map<NotifyKind, number>()

  constructor(
    private readonly cfg: TelegramConfig,
    opts: NotifierOptions = {}
  ) {
    this.fetchImpl = opts.fetch ?? fetch
    this.now = opts.now ?? Date.now
    this.throttle = { ...THROTTLE_MS, ...opts.throttleMs }
    this.logError = opts.logError ?? ((m, meta) => console.error(m, meta))
  }

  /**
   * Send a message of `kind`. Returns true when it was actually dispatched,
   * false when skipped (not configured, throttled, or the API call failed).
   */
  async notify(kind: NotifyKind, text: string): Promise<boolean> {
    if (!isTelegramConfigured(this.cfg)) return false

    const now = this.now()
    const prev = this.lastSent.get(kind)
    if (prev !== undefined && now - prev < this.throttle[kind]) {
      return false
    }
    // Record the attempt BEFORE awaiting so concurrent calls within the window
    // are throttled even if the network call is slow.
    this.lastSent.set(kind, now)

    try {
      const res = await this.fetchImpl(
        `https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.cfg.chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        }
      )
      if (!res.ok) {
        this.logError('[cloud-hooks] telegram sendMessage non-2xx', {
          kind,
          status: res.status,
        })
        return false
      }
      return true
    } catch (err) {
      this.logError('[cloud-hooks] telegram sendMessage failed', { kind, err })
      return false
    }
  }
}

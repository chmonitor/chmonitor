/**
 * Slack channel id on a webhook alert route (#4241). Pure, no imports, so the
 * routes API, the routing.yaml reader, and the settings form share one parser.
 *
 * With a channel id set and the Slack app installed in the webhook's
 * workspace, alerts post through the bot (threaded details, edited on
 * recovery) instead of the incoming webhook.
 */

const SLACK_CHANNEL_ID_RE = /^[CGD][A-Z0-9]+$/

/**
 * Parse an operator-supplied channel id. Empty / missing → `null` (feature
 * off); a malformed value → `'invalid'`; otherwise the trimmed id.
 */
export function parseSlackChannelId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return 'invalid'
  const value = raw.trim()
  if (!value) return null
  return SLACK_CHANNEL_ID_RE.test(value) ? value : 'invalid'
}

/**
 * The workspace (team) id in a Slack incoming-webhook URL,
 * `https://hooks.slack.com/services/T…/B…/…`, or null for any other URL.
 */
export function slackWebhookTeamId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'hooks.slack.com') return null
    const match = /^\/services\/(T[A-Z0-9]+)\//.exec(parsed.pathname)
    return match ? match[1] : null
  } catch {
    return null
  }
}

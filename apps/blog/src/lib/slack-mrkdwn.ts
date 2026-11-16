/**
 * Slack mrkdwn to HTML, for the subset chmonitor alerts send: *bold*,
 * _italic_, ~strike~, `code`, "> " quotes, <url|label> links, <@U…> mentions
 * and :emoji: names. Slack escapes only &, < and >, so text is decoded once
 * and escaped again for HTML; the result is safe to inject.
 */

/** Emoji names the demo uses, as reactions or a bot icon. */
const EMOJI: Record<string, string> = {
  eyes: '👀',
  white_check_mark: '✅',
  rotating_light: '🚨',
}

/** `eyes` or `:eyes:` to its character, or undefined when unknown. */
export function emojiChar(name: string): string | undefined {
  return EMOJI[name.replace(/^:|:$/g, '')]
}

function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function emojify(html: string): string {
  return html.replace(/:([a-z0-9_+-]+):/g, (all, name) => EMOJI[name] ?? all)
}

/** Slack only formats a marker pair that sits between word boundaries. */
const MARKERS: [RegExp, string][] = [
  [/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<strong>$2</strong>'],
  [/(^|\W)_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>'],
  [/(^|[^\w~])~(?=\S)([^~]*?\S)~(?![\w~])/g, '$1<del>$2</del>'],
]

function emphasis(raw: string): string {
  let html = esc(decode(raw))
  for (const [re, tag] of MARKERS) html = html.replace(re, tag)
  return emojify(html)
}

function angle(inner: string, users: Record<string, string>): string {
  if (inner.startsWith('@')) {
    const id = inner.slice(1).split('|')[0]
    return `<span class="slack-mention">@${esc(users[id] ?? id)}</span>`
  }
  if (inner.startsWith('!')) {
    return `<span class="slack-mention">@${esc(inner.slice(1).split('|')[0])}</span>`
  }
  const bar = inner.indexOf('|')
  const url = decode(bar === -1 ? inner : inner.slice(0, bar))
  const label = esc(decode(bar === -1 ? inner : inner.slice(bar + 1)))
  if (!/^(https?:|mailto:)/i.test(url)) return label
  return `<a href="${esc(url).replace(/"/g, '&quot;')}">${label}</a>`
}

/** Code spans and <…> tokens first: nothing inside them is formatted. */
function inline(line: string, users: Record<string, string>): string {
  let html = ''
  let last = 0
  for (const m of line.matchAll(/`([^`]+)`|<([^<>]+)>/g)) {
    html += emphasis(line.slice(last, m.index))
    html +=
      m[1] === undefined
        ? angle(m[2], users)
        : `<code>${esc(decode(m[1]))}</code>`
    last = m.index + m[0].length
  }
  return html + emphasis(line.slice(last))
}

/**
 * Render a mrkdwn string. `users` maps user ids to the names a mention
 * shows. Consecutive "> " lines become one blockquote; an escaped `&gt;` at
 * the start of a line stays text, as in Slack.
 */
export function mrkdwnToHtml(
  text: string,
  users: Record<string, string> = {}
): string {
  const parts: string[] = []
  let quote: string[] = []
  let afterLine = false
  const flush = () => {
    if (quote.length === 0) return
    parts.push(`<blockquote>${quote.join('<br>')}</blockquote>`)
    quote = []
    afterLine = false
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('>')) {
      quote.push(inline(line.replace(/^> ?/, ''), users))
      continue
    }
    flush()
    if (afterLine) parts.push('<br>')
    parts.push(inline(line, users))
    afterLine = true
  }
  flush()
  return parts.join('')
}

/** A plain_text object: escaped, with emoji names drawn. */
export function plainToHtml(text: string): string {
  return emojify(esc(text))
}

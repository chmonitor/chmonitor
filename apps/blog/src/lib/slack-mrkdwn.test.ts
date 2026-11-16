import { emojiChar, mrkdwnToHtml, plainToHtml } from './slack-mrkdwn'
import { describe, expect, test } from 'bun:test'

describe('mrkdwnToHtml', () => {
  test('bold severity, escaped link url and label', () => {
    expect(
      mrkdwnToHtml(
        '🟠 *WARNING*  Disk Usage · <https://a.example.com/h?host=0&amp;x=1|Open>'
      )
    ).toBe(
      '🟠 <strong>WARNING</strong>  Disk Usage · <a href="https://a.example.com/h?host=0&amp;x=1">Open</a>'
    )
  })

  test('consecutive "> " lines become one blockquote after the lead line', () => {
    expect(
      mrkdwnToHtml(
        '🟢 *RESOLVED*  Disk Usage\n> 🟠 *WARNING*  84\n> fired 09:12'
      )
    ).toBe(
      '🟢 <strong>RESOLVED</strong>  Disk Usage<blockquote>🟠 <strong>WARNING</strong>  84<br>fired 09:12</blockquote>'
    )
  })

  test('an escaped > is text, and escaped markup stays escaped', () => {
    expect(mrkdwnToHtml('&gt; no quote &lt;b&gt;x&lt;/b&gt; &amp;amp;')).toBe(
      '&gt; no quote &lt;b&gt;x&lt;/b&gt; &amp;amp;'
    )
  })

  test('nothing inside a code span is formatted', () => {
    expect(mrkdwnToHtml('84% used\n`▁▄█ 70 → 84 (warn *80*)`')).toBe(
      '84% used<br><code>▁▄█ 70 → 84 (warn *80*)</code>'
    )
  })

  test('underscores inside identifiers are not italic, a wrapped phrase is', () => {
    expect(mrkdwnToHtml('stuck_merges_total · _…and 3 more_ · ~old~')).toBe(
      'stuck_merges_total · <em>…and 3 more</em> · <del>old</del>'
    )
  })

  test('mentions use the name map; unknown emoji names and times stay text', () => {
    expect(
      mrkdwnToHtml('✅ Acknowledged by <@U0DEMO1> · 09:52:00 :eyes: :nope:', {
        U0DEMO1: 'mai',
      })
    ).toBe(
      '✅ Acknowledged by <span class="slack-mention">@mai</span> · 09:52:00 👀 :nope:'
    )
  })

  test('a link that is not http or mailto renders as its label only', () => {
    expect(
      mrkdwnToHtml('<javascript:alert(1)|click> <https://x.example.com>')
    ).toBe('click <a href="https://x.example.com">https://x.example.com</a>')
  })
})

describe('emoji and plain text', () => {
  test('emojiChar takes the name with or without colons', () => {
    expect([
      emojiChar(':rotating_light:'),
      emojiChar('eyes'),
      emojiChar('x'),
    ]).toEqual(['🚨', '👀', undefined])
  })

  test('plain_text is escaped and never formatted', () => {
    expect(plainToHtml('*Ack* <now> :white_check_mark:')).toBe(
      '*Ack* &lt;now&gt; ✅'
    )
  })
})

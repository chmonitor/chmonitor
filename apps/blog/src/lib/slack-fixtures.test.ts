import { parseSlackDemo } from './slack-fixtures'
import { describe, expect, test } from 'bun:test'

function demoWith(blocks: unknown[], color = '#f59e0b') {
  const message = {
    author: 'bot',
    ts: '2026-11-16T09:12:00.000Z',
    body: { attachments: [{ color, blocks }] },
  }
  const thread = { parent: message, replies: [] }
  return {
    channel: 'alerts',
    authors: { webhook: { name: 'w' }, bot: { name: 'b' } },
    users: {},
    threads: {
      webhook: thread,
      newAlert: thread,
      escalation: thread,
      ack: thread,
      resolved: thread,
    },
  }
}

describe('parseSlackDemo', () => {
  test('a block type the components cannot draw fails loudly', () => {
    expect(() => parseSlackDemo(demoWith([{ type: 'image' }]))).toThrow(
      'Slack demo: no renderer for block type "image"'
    )
  })

  test('a field the components do not draw fails loudly', () => {
    const section = {
      type: 'section',
      text: { type: 'mrkdwn', text: 'x' },
      accessory: { type: 'image' },
    }
    expect(() => parseSlackDemo(demoWith([section]))).toThrow(
      'Slack demo: section field "accessory" is not drawn'
    )
  })

  test('an attachment colour that is not #rrggbb is rejected', () => {
    expect(() =>
      parseSlackDemo(demoWith([{ type: 'divider' }], 'red;background:url(x)'))
    ).toThrow(
      'Slack demo: attachment colour "red;background:url(x)" is not #rrggbb'
    )
  })
})

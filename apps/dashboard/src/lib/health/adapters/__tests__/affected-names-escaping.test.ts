/**
 * Affected names (#3869) come from the monitored cluster: a table can be
 * called `<script>` or `<!channel>`. They reach every channel inside the
 * alert label, so every HTML or markup body must escape the label, single
 * alert and digest alike.
 */

import type { AlertPayload } from '../types'

import {
  buildEmailBody,
  buildHookshotBody,
  buildHookshotDigestBody,
  buildMatrixBody,
  buildMatrixDigestBody,
  buildSlackBody,
  buildSlackDigestBody,
} from '../index'
import { describe, expect, test } from 'bun:test'
import { buildAlertBlocksWithAck } from '@/lib/slack/blocks'

const payload: AlertPayload = {
  severity: 'critical',
  hostLabel: 'ch-1',
  hostId: 0,
  metric: 'stuck-merges',
  value: 2,
  title: 'Stuck Merges',
  label: '2 stuck merges: db.<script>x</script> p1, db.<!channel> p2',
  timestamp: '2026-10-18T00:00:00.000Z',
}
const other: AlertPayload = { ...payload, hostId: 1, hostLabel: 'ch-2' }

describe('affected names are escaped in markup bodies', () => {
  test('Matrix and Hookshot HTML, single and digest', () => {
    const htmls = [
      buildMatrixBody(payload).formatted_body,
      buildMatrixDigestBody([payload, other]).formatted_body,
      buildHookshotBody(payload).html,
      buildHookshotDigestBody([payload, other]).html,
    ]
    for (const html of htmls) {
      expect(html).toContain('db.&lt;script&gt;x&lt;/script&gt; p1')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<!channel>')
    }
  })

  test('email HTML', () => {
    const { html } = buildEmailBody(payload)
    expect(html).toContain('db.&lt;script&gt;x&lt;/script&gt; p1')
    expect(html).not.toContain('<script>')
  })

  test('Slack mrkdwn, single, digest and app ack blocks, cannot ping the channel', () => {
    const bodies = [
      JSON.stringify(buildSlackBody(payload)),
      JSON.stringify(buildSlackDigestBody([payload, other])),
      JSON.stringify(
        buildAlertBlocksWithAck(payload, {
          hostId: 0,
          ruleId: 'stuck-merges',
          severity: 'critical',
        })
      ),
    ]
    for (const body of bodies) expect(body).not.toContain('<!channel>')
    // The webhook line leaves the label out (#4241: details sit behind the
    // dashboard link); the app's ack blocks still show it, escaped.
    expect(bodies[2]).toContain('db.&lt;!channel&gt; p2')
  })
})

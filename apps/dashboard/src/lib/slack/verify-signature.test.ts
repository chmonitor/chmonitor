/**
 * Real-crypto tests for the Slack request signature gate — the inbound-auth
 * invariant of plans/37-slack-app-native-oauth.md: chmonitor never trusts a
 * Slack payload it can't verify, and rejects replays. No mocks — this computes
 * real HMAC-SHA256 signatures over the `v0:${ts}:${body}` basestring so the
 * accept/reject paths are proven against the actual crypto.
 *
 * Covers the plan's required assertions: a correctly-signed request passes, a
 * tampered body is rejected, and a stale timestamp is rejected.
 */

import {
  computeSlackSignature,
  MAX_TIMESTAMP_SKEW_SECONDS,
  verifySlackRequest,
} from './verify-signature'
import { describe, expect, test } from 'bun:test'

const SECRET = 'test-signing-secret'
// A representative slash-command body (application/x-www-form-urlencoded).
const BODY =
  'token=xxx&team_id=T123&command=%2Fchmonitor&text=status&response_url=https%3A%2F%2Fhooks.slack.com%2Fx'
const NOW = 1_700_000_000

describe('verifySlackRequest', () => {
  test('a correctly-signed, fresh request is accepted', async () => {
    const ts = String(NOW)
    const signature = await computeSlackSignature(SECRET, ts, BODY)
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: ts,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(true)
  })

  test('a tampered body is rejected', async () => {
    const ts = String(NOW)
    const signature = await computeSlackSignature(SECRET, ts, BODY)
    const tampered = BODY.replace('text=status', 'text=drop+table')
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: ts,
        rawBody: tampered,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('a stale timestamp (beyond the skew window) is rejected even if signed', async () => {
    const staleTs = String(NOW - MAX_TIMESTAMP_SKEW_SECONDS - 1)
    // Signature is valid for the stale timestamp, but freshness must still fail.
    const signature = await computeSlackSignature(SECRET, staleTs, BODY)
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: staleTs,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('a future timestamp beyond the skew window is rejected (replay/clock skew)', async () => {
    const futureTs = String(NOW + MAX_TIMESTAMP_SKEW_SECONDS + 1)
    const signature = await computeSlackSignature(SECRET, futureTs, BODY)
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: futureTs,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('a signature computed with the wrong secret is rejected', async () => {
    const ts = String(NOW)
    const signature = await computeSlackSignature(
      'a-different-secret',
      ts,
      BODY
    )
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: ts,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('missing signature / timestamp headers are rejected', async () => {
    const ts = String(NOW)
    const signature = await computeSlackSignature(SECRET, ts, BODY)
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature: null,
        timestamp: ts,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: null,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('a signature header missing the v0= prefix is rejected', async () => {
    const ts = String(NOW)
    const signature = await computeSlackSignature(SECRET, ts, BODY)
    const rawHex = signature.replace('v0=', '')
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature: rawHex,
        timestamp: ts,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('a non-numeric timestamp is rejected', async () => {
    const signature = await computeSlackSignature(SECRET, 'not-a-number', BODY)
    expect(
      await verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: 'not-a-number',
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })

  test('an empty signing secret is rejected', async () => {
    const ts = String(NOW)
    const signature = await computeSlackSignature(SECRET, ts, BODY)
    expect(
      await verifySlackRequest({
        signingSecret: '',
        signature,
        timestamp: ts,
        rawBody: BODY,
        nowSeconds: NOW,
      })
    ).toBe(false)
  })
})

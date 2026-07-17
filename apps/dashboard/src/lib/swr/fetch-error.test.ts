/**
 * Tests for `describeError` (fetch-error.ts).
 *
 * These encode the reason the helper exists (issue #2687): a failed mutation
 * must tell the user *why* it failed — a 403 must not look identical to a 500
 * or to a dropped connection — while never rendering a toast description that
 * adds nothing over the caller's own title.
 */

import type { FetchError } from './fetch-error'

import { describeError, throwIfNotOk } from './fetch-error'
import { describe, expect, it } from 'bun:test'

function fetchError(message: string, status?: number): FetchError {
  const err = new Error(message) as FetchError
  if (status !== undefined) err.status = status
  return err
}

describe('describeError', () => {
  it("surfaces the server's message for a permission failure", () => {
    expect(describeError(fetchError('Not enough privileges', 403))).toBe(
      'Not enough privileges (HTTP 403)'
    )
  })

  it('distinguishes a 500 from a 403 with the same message', () => {
    const forbidden = describeError(fetchError('Request failed', 403))
    const serverError = describeError(fetchError('Request failed', 500))
    expect(forbidden).not.toBe(serverError)
  })

  it('describes a network drop, which carries no HTTP status', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe(
      'Failed to fetch'
    )
  })

  it('does not repeat a status the message already carries', () => {
    // `throwIfNotOk` builds "<fallback>: <statusText>" messages, and some APIs
    // put the code in the message itself — don't render "... 503 (HTTP 503)".
    expect(describeError(fetchError('Upstream returned 503', 503))).toBe(
      'Upstream returned 503'
    )
  })

  it('falls back to the bare status when there is no message', () => {
    expect(describeError(fetchError('', 502))).toBe('HTTP 502')
  })

  it('returns undefined when the error says nothing, so no empty description', () => {
    expect(describeError(new Error(''))).toBeUndefined()
    expect(describeError(undefined)).toBeUndefined()
    expect(describeError(null)).toBeUndefined()
    expect(describeError({})).toBeUndefined()
  })

  it('accepts a thrown string', () => {
    expect(describeError('boom')).toBe('boom')
  })

  it('describes what throwIfNotOk actually throws', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'Subscription not found' } }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    )

    const err = await throwIfNotOk(response, 'Failed to delete subscription')
      .then(() => null)
      .catch((e: unknown) => e)

    expect(describeError(err)).toBe('Subscription not found (HTTP 404)')
  })
})

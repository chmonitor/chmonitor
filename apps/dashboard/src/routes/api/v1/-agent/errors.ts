/**
 * Error → HTTP response mapping for the agent endpoint.
 *
 * Every response body/status here is byte-identical to what `handlePost`
 * returned inline before the split (issue #2885): the chat client parses these
 * shapes, so they are part of the endpoint's public contract.
 */

import {
  AGENT_MAX_MESSAGES,
  AGENT_MAX_REQUEST_SIZE_BYTES,
  type ParseAgentRequestFailure,
} from './request-parsing'
import { classifyError } from '@/lib/ai/agent/errors'
import { providerNotConfiguredMessage } from '@/lib/ai/providers'

/** JSON error response with the endpoint's standard content-type. */
export function jsonErrorResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Map a request-parsing failure onto its (unchanged) HTTP response. */
export function parseFailureResponse(
  failure: ParseAgentRequestFailure
): Response {
  switch (failure.reason) {
    case 'payload_too_large':
      return jsonErrorResponse(
        {
          error: {
            message: 'Request payload too large',
            limitBytes: AGENT_MAX_REQUEST_SIZE_BYTES,
          },
        },
        413
      )
    case 'invalid_json':
      return jsonErrorResponse(
        {
          error: {
            message: 'Invalid JSON payload',
            code: 'INVALID_JSON',
          },
        },
        400
      )
    case 'too_many_messages':
      return jsonErrorResponse(
        {
          error: {
            message: `Too many messages. Maximum is ${AGENT_MAX_MESSAGES}.`,
            maxMessages: AGENT_MAX_MESSAGES,
          },
        },
        400
      )
    case 'no_valid_messages':
      return jsonErrorResponse(
        { error: { message: 'No valid messages were provided.' } },
        400
      )
    case 'message_required':
      return jsonErrorResponse(
        { error: { message: 'Message is required and must be a string' } },
        400
      )
  }
}

/**
 * 503 for a model whose provider has no API key on this deployment. Without
 * this preflight the upstream provider returns a confusing "Missing
 * Authorization header" error that looks like *our* auth failed.
 */
export function providerNotConfiguredResponse(
  model: string,
  provider: string
): Response {
  const classified = classifyError(
    {
      statusCode: 503,
      error: {
        code: 'provider_not_configured',
        message: providerNotConfiguredMessage(provider),
      },
    },
    { model, provider }
  )

  return jsonErrorResponse({ error: classified }, 503)
}

/**
 * Outermost error boundary mapping: convert any uncaught throw into a
 * structured, classified `application/json` error the chat UI can render
 * (title, cause, suggestion) and log the raw cause so the true origin is
 * visible in worker logs / Sentry.
 */
export function unhandledErrorResponse(error: unknown): Response {
  const classified = classifyError(error)
  console.error('[Agent API] Unhandled error:', classified, error)
  const status =
    typeof classified.statusCode === 'number' && classified.statusCode >= 400
      ? classified.statusCode
      : 500
  return jsonErrorResponse({ error: classified }, status)
}

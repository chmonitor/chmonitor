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
import {
  type ClassifyErrorContext,
  classifyError,
  sanitizeAgentError,
} from '@/lib/ai/agent/errors'
import { providerNotConfiguredMessage } from '@/lib/ai/providers'
import { demoHiddenUnavailable } from '@/lib/cloud/reject-demo-host'

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
    case 'invalid_host_id':
      return jsonErrorResponse(
        {
          error: {
            message: 'Invalid hostId: must be an integer',
            code: 'INVALID_HOST_ID',
          },
        },
        400
      )
  }
}

/**
 * Why a negative (per-user connection) host id could not be used: the caller
 * is not signed in, or `resolveAgentConnection` refused it. A foreign or
 * missing connection is a 404 that never says whether the id exists.
 */
export type AgentConnectionFailure =
  | 'not_signed_in'
  | 'storage_disabled'
  | 'browser_connection'
  | 'not_found'
  | 'unsupported_engine'

export function agentConnectionFailureResponse(
  reason: AgentConnectionFailure
): Response {
  if (reason === 'not_found') {
    return jsonErrorResponse(
      {
        error: {
          message: 'Connection not found',
          code: 'CONNECTION_NOT_FOUND',
        },
      },
      404
    )
  }
  const messages: Record<
    Exclude<AgentConnectionFailure, 'not_found'>,
    string
  > = {
    not_signed_in: 'Sign in to use the assistant on your own connections.',
    storage_disabled:
      'Saved connections are not enabled on this deployment. Switch to a configured host.',
    browser_connection:
      'The assistant can only query connections saved to your account, not ones stored in this browser.',
    unsupported_engine:
      'The assistant can only query ClickHouse connections. Switch to a ClickHouse host.',
  }
  return jsonErrorResponse(
    {
      error: {
        message: messages[reason],
        code: 'USER_CONNECTION_HOST_UNSUPPORTED',
        reason,
      },
    },
    400
  )
}

/**
 * 403 when a signed-in cloud user targets the hidden env/demo host. The body
 * carries the same `demo_hidden` reason the data routes use.
 */
export function demoHostBlockedResponse(): Response {
  return jsonErrorResponse(
    { error: { code: 'demo_hidden', ...demoHiddenUnavailable() } },
    403
  )
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
export function unhandledErrorResponse(
  error: unknown,
  context: ClassifyErrorContext = {},
  extraSecrets: readonly (string | null | undefined)[] = []
): Response {
  const classified =
    extraSecrets.length > 0
      ? sanitizeAgentError(classifyError(error, context), extraSecrets)
      : classifyError(error, context)
  console.error('[Agent API] Unhandled error:', classified, error)
  const status =
    typeof classified.statusCode === 'number' && classified.statusCode >= 400
      ? classified.statusCode
      : 500
  return jsonErrorResponse({ error: classified }, status)
}

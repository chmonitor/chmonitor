/**
 * Pure mapping from the agent route's pre-stream error bodies to an actionable
 * message. The route (see `routes/api/v1/-agent/errors.ts`) answers before the
 * stream starts with `{ error: { code, reason?, message } }`; the AI SDK puts
 * that JSON body in `Error.message`. These are not `AgentError`s (no `type`),
 * so without this they would show as raw text.
 */

export interface AgentConnectionErrorAction {
  label: string
  /** In-app route; every current action goes to the add-connection flow. */
  to: '/setup'
}

export interface AgentConnectionErrorView {
  /** Stable key, useful for tests and `data-` attributes. */
  kind:
    | 'demo_hidden'
    | 'browser_connection'
    | 'postgres'
    | 'storage_off'
    | 'not_signed_in'
    | 'not_found'
    | 'invalid_host'
  title: string
  message: string
  action?: AgentConnectionErrorAction
}

const ADD_CONNECTION: AgentConnectionErrorAction = {
  label: 'Add a connection',
  to: '/setup',
}

/** Also shown up front on the welcome screen when the user has no connection. */
export const ADD_CONNECTION_VIEW: AgentConnectionErrorView = {
  kind: 'demo_hidden',
  title: 'Add a ClickHouse connection to use the assistant on your own data',
  message:
    'The shared demo host is hidden once you are signed in. Connect your own ClickHouse to start asking questions.',
  action: ADD_CONNECTION,
}

function parseBody(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw instanceof Error ? raw.message : raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  const nested = body.error
  return nested && typeof nested === 'object'
    ? (nested as Record<string, unknown>)
    : body
}

/** Returns a view for a known pre-stream connection error, else `null`. */
export function mapAgentConnectionError(
  raw: unknown
): AgentConnectionErrorView | null {
  const err = parseBody(raw)
  if (!err) return null
  const code = typeof err.code === 'string' ? err.code : undefined
  const reason = typeof err.reason === 'string' ? err.reason : undefined

  if (code === 'demo_hidden' || reason === 'demo_hidden') {
    return ADD_CONNECTION_VIEW
  }
  if (code === 'CONNECTION_NOT_FOUND') {
    return {
      kind: 'not_found',
      title: 'This connection no longer exists',
      message:
        'It may have been deleted. Pick another connection from the host switcher, or add a new one.',
      action: ADD_CONNECTION,
    }
  }
  if (code === 'INVALID_HOST_ID') {
    return {
      kind: 'invalid_host',
      title: 'Could not tell which connection to use',
      message:
        'Select a connection from the host switcher and try again. If it keeps happening, reload the page.',
    }
  }
  if (code === 'USER_CONNECTION_HOST_UNSUPPORTED') {
    switch (reason) {
      case 'browser_connection':
        return {
          kind: 'browser_connection',
          title:
            'Save this connection to your account to use it with the assistant',
          message:
            'Connections stored only in this browser are not available to the assistant.',
          action: { label: 'Save connection', to: '/setup' },
        }
      case 'postgres':
        return {
          kind: 'postgres',
          title: 'The assistant works with ClickHouse connections',
          message: 'Switch to a ClickHouse host to ask questions.',
        }
      case 'storage_off':
        return {
          kind: 'storage_off',
          title: 'Saved connections are off on this deployment',
          message:
            'The assistant can only use the hosts configured by the operator here. Switch to one of those hosts.',
        }
      case 'not_signed_in':
        return {
          kind: 'not_signed_in',
          title: 'Sign in to use the assistant on your own connections',
          message: 'Sign in, then try again.',
        }
    }
  }
  return null
}

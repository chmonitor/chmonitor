import type { McpErrorKind } from '@/lib/mcp'

/** Friendly copy per failure shape — never surface a raw fetch error. */
export function describeError(kind: McpErrorKind): {
  title: string
  hint: string
  needsKey: boolean
} {
  switch (kind) {
    case 'unauthorized':
      return {
        title: 'This endpoint requires authentication',
        hint: 'Paste an API key below, or sign in with an MCP client that completes the OAuth flow. Self-hosted deployments can set CHM_MCP_PUBLIC=true for an open endpoint.',
        needsKey: true,
      }
    case 'payment_required':
    case 'forbidden':
      return {
        title: 'MCP access is not enabled for this plan',
        hint: 'The hosted MCP endpoint is available on the Max and Enterprise plans. Self-hosted deployments are never gated.',
        needsKey: false,
      }
    case 'rate_limited':
      return {
        title: 'Rate limit reached',
        hint: 'The endpoint throttles requests per IP. Wait a moment and run the tool again.',
        needsKey: false,
      }
    case 'protocol':
      return {
        title: 'The server rejected the request',
        hint: 'The response was not a valid MCP result. The details are in the inspector below.',
        needsKey: false,
      }
    default:
      return {
        title: 'Could not reach the MCP endpoint',
        hint: 'Check that the endpoint URL is reachable from this browser.',
        needsKey: false,
      }
  }
}

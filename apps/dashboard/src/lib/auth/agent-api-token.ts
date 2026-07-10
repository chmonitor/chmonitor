import { getBearerToken } from '@chm/mcp-server/auth'
import { constantTimeEqual } from '@/lib/auth/providers/constant-time'

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  )
  return new Uint8Array(digest)
}

export async function isValidAgentApiBearerToken(
  request: Request
): Promise<boolean> {
  const expectedToken = process.env.AGENT_API_TOKEN
  if (!expectedToken) {
    return false
  }

  const providedToken = getBearerToken(request.headers.get('authorization'))
  if (!providedToken) {
    return false
  }

  const [expectedHash, providedHash] = await Promise.all([
    sha256(expectedToken),
    sha256(providedToken),
  ])

  return constantTimeEqual(expectedHash, providedHash)
}

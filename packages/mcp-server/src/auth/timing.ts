/**
 * Shared timing-safe string/byte comparators for auth secrets and signatures.
 * Single canonical implementation — do not duplicate elsewhere.
 */

/** Constant-time byte comparison. Returns false immediately on length mismatch. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index]
  }

  return diff === 0
}

/** Constant-time string secret comparison (UTF-8 encoded). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  return constantTimeEqual(encoder.encode(a), encoder.encode(b))
}

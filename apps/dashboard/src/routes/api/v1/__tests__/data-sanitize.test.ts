import { describe, expect, test } from 'bun:test'
import {
  SANITIZED_MESSAGES,
  sanitizeDbQueryError,
} from '@/lib/api/error-handler/sanitize-error'

describe('query route error sanitization contract', () => {
  test('upstream hostname and table names are not echoed to clients', () => {
    const raw =
      "Code: 60. DB::Exception: Table secret.internal_table doesn't exist (10.0.0.5:8123)"
    const sanitized = sanitizeDbQueryError(raw)
    expect(sanitized).toBe(SANITIZED_MESSAGES.NOT_FOUND)
    expect(sanitized).not.toContain('secret')
    expect(sanitized).not.toContain('10.0.0.5')
    expect(sanitized).not.toContain('internal_table')
  })
})

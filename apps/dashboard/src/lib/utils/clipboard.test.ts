import { copyToClipboard } from './clipboard'
import { describe, expect, test } from 'bun:test'

describe('clipboard utility', () => {
  test('copyToClipboard returns boolean success status', async () => {
    const testText = 'Test clipboard content'

    // This should either succeed or gracefully fail
    const result = await copyToClipboard(testText)
    expect(typeof result).toBe('boolean')

    // If in a supported environment, verify the copy worked
    if (navigator.clipboard && window.isSecureContext) {
      expect(result).toBe(true)
      const clipboardText = await navigator.clipboard.readText()
      expect(clipboardText).toBe(testText)
    }
  })

  test('copyToClipboard handles special characters', async () => {
    const specialText = 'SQL: SELECT * FROM `table` WHERE "col" = \'value\''
    const result = await copyToClipboard(specialText)
    expect(typeof result).toBe('boolean')

    // If in a supported environment, verify the copy worked
    if (navigator.clipboard && window.isSecureContext) {
      expect(result).toBe(true)
      const clipboardText = await navigator.clipboard.readText()
      expect(clipboardText).toBe(specialText)
    }
  })
})

/**
 * Copy text to clipboard with fallback for unsupported environments.
 *
 * The Clipboard API (navigator.clipboard) is only available in secure contexts
 * (HTTPS) and can be undefined in development (HTTP), iframes, or older browsers.
 *
 * Fallback strategy:
 * 1. Try modern navigator.clipboard.writeText() (requires secure context)
 * 2. Fallback to document.execCommand('copy') with a temporary textarea
 *
 * @example
 * ```ts
 * import { copyToClipboard } from '@/lib/utils/clipboard'
 *
 * const success = await copyToClipboard('Hello, world!')
 * if (!success) {
 *   console.error('Failed to copy')
 * }
 * ```
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  // Method 1: Modern Clipboard API (preferred)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (error) {
      // Fall through to legacy method if Clipboard API fails
    }
  }

  // Method 2: Legacy document.execCommand fallback
  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    textArea.style.top = '-999999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    const successful = document.execCommand('copy')
    document.body.removeChild(textArea)

    if (successful) {
      return true
    }

    throw new Error('execCommand failed')
  } catch (error) {
    return false
  }
}

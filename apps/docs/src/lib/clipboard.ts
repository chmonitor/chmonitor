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
 * import { copyToClipboard } from '@/lib/clipboard'
 *
 * const success = await copyToClipboard('Hello, world!')
 * if (!success) {
 *   console.error('Failed to copy')
 * }
 * ```
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  // Method 1: Modern Clipboard API (preferred). Guard on `navigator` itself
  // (undefined during SSR) and on `navigator.clipboard` (undefined in
  // insecure/HTTP contexts in Firefox/Chrome, and in some iframes) before
  // touching `.writeText` — accessing it directly throws.
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard?.writeText &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_error) {
      // Fall through to legacy method if Clipboard API fails
    }
  }

  // Method 2: Legacy document.execCommand fallback
  if (typeof document === 'undefined') return false
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
  } catch (_error) {
    return false
  }
}

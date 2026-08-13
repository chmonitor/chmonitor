import { copyToClipboard } from './clipboard'
import { afterEach, describe, expect, mock, test } from 'bun:test'

describe('clipboard utility (no DOM/navigator — SSR-like)', () => {
  test('copyToClipboard returns boolean success status', async () => {
    const testText = 'Test clipboard content'

    // This should either succeed or gracefully fail
    const result = await copyToClipboard(testText)
    expect(typeof result).toBe('boolean')

    // If in a supported environment, verify the copy worked. `window` isn't
    // defined at all under plain bun:test, so check it before touching it —
    // `navigator.clipboard` being undefined normally short-circuits this,
    // but that's not guaranteed once other tests in this file start
    // stubbing `navigator.clipboard`.
    if (
      typeof window !== 'undefined' &&
      navigator.clipboard &&
      window.isSecureContext
    ) {
      expect(result).toBe(true)
      const clipboardText = await navigator.clipboard.readText()
      expect(clipboardText).toBe(testText)
    }
  })

  test('copyToClipboard handles special characters', async () => {
    const specialText = 'SQL: SELECT * FROM `table` WHERE "col" = \'value\''
    const result = await copyToClipboard(specialText)
    expect(typeof result).toBe('boolean')

    // If in a supported environment, verify the copy worked. `window` isn't
    // defined at all under plain bun:test, so check it before touching it —
    // `navigator.clipboard` being undefined normally short-circuits this,
    // but that's not guaranteed once other tests in this file start
    // stubbing `navigator.clipboard`.
    if (
      typeof window !== 'undefined' &&
      navigator.clipboard &&
      window.isSecureContext
    ) {
      expect(result).toBe(true)
      const clipboardText = await navigator.clipboard.readText()
      expect(clipboardText).toBe(specialText)
    }
  })
})

/**
 * Regression coverage for the production Sentry bug: in an insecure context
 * (plain HTTP, e.g. an internal IP like http://10.20.155.237:3000), Firefox
 * and Chrome leave `navigator.clipboard` undefined. Every call site used to
 * call `navigator.clipboard.writeText` directly, throwing
 * `TypeError: can't access property "writeText", navigator.clipboard is
 * undefined`. `copyToClipboard` must fall back to the `document.execCommand`
 * textarea method instead of throwing.
 */
describe('clipboard utility (DOM present, insecure context)', () => {
  // bun:test has no `window`/`document` globals by default (unlike a browser
  // or happy-dom), so these tests install minimal fakes rather than pulling
  // in a full DOM implementation — enough to exercise the textarea +
  // execCommand fallback path exactly as `copyToClipboard` uses it.
  function installFakeTextareaDom(execCommandImpl: () => boolean) {
    const style: Record<string, string> = {}
    const textarea = {
      value: '',
      style,
      focus: mock(() => {}),
      select: mock(() => {}),
    }
    const body = {
      appendChild: mock(() => {}),
      removeChild: mock(() => {}),
    }
    const execCommand = mock(execCommandImpl)
    ;(globalThis as { document?: unknown }).document = {
      createElement: mock(() => textarea),
      body,
      execCommand,
    }
    return { textarea, body, execCommand }
  }

  afterEach(() => {
    // @ts-expect-error — tear down the fakes installed by each test
    delete globalThis.window
    // @ts-expect-error — tear down the fakes installed by each test
    delete globalThis.document
    if ('clipboard' in navigator) {
      // @ts-expect-error — undo the per-test navigator.clipboard override
      delete navigator.clipboard
    }
  })

  test('falls back to execCommand when navigator.clipboard is undefined', async () => {
    ;(globalThis as { window?: unknown }).window = { isSecureContext: false }
    const { execCommand } = installFakeTextareaDom(() => true)

    const result = await copyToClipboard('insecure context text')

    expect(result).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  test('returns false (never throws) when both the Clipboard API and execCommand are unavailable', async () => {
    ;(globalThis as { window?: unknown }).window = { isSecureContext: false }
    installFakeTextareaDom(() => false)

    await expect(copyToClipboard('no clipboard anywhere')).resolves.toBe(false)
  })

  test('prefers navigator.clipboard.writeText in a secure context', async () => {
    ;(globalThis as { window?: unknown }).window = { isSecureContext: true }
    const writeText = mock(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const { execCommand } = installFakeTextareaDom(() => true)

    const result = await copyToClipboard('secure context text')

    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith('secure context text')
    expect(execCommand).not.toHaveBeenCalled()
  })
})

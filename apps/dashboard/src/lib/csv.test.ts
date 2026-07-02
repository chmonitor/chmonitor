import { arrayToCsv, downloadCsv, slugifyFilename, valueToCsv } from './csv'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

// ---------------------------------------------------------------------------
// valueToCsv
// ---------------------------------------------------------------------------

describe('valueToCsv', () => {
  it('returns empty string for null', () => {
    expect(valueToCsv(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(valueToCsv(undefined)).toBe('')
  })

  it('returns plain string unchanged when no special chars', () => {
    expect(valueToCsv('hello')).toBe('hello')
  })

  it('wraps in quotes when value contains a comma', () => {
    expect(valueToCsv('a,b')).toBe('"a,b"')
  })

  it('wraps in quotes when value contains a newline', () => {
    expect(valueToCsv('line1\nline2')).toBe('"line1\nline2"')
  })

  it('wraps in quotes when value contains a carriage return', () => {
    expect(valueToCsv('line1\rline2')).toBe('"line1\rline2"')
  })

  it('wraps in quotes when value contains a CRLF sequence', () => {
    expect(valueToCsv('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('wraps in quotes and doubles embedded quotes', () => {
    expect(valueToCsv('say "hi"')).toBe('"say ""hi"""')
  })

  it('handles value with both quotes and commas', () => {
    expect(valueToCsv('"a","b"')).toBe('"""a"",""b"""')
  })

  it('converts numbers to their string representation', () => {
    expect(valueToCsv(42)).toBe('42')
    expect(valueToCsv(3.14)).toBe('3.14')
  })

  it('converts boolean values to string', () => {
    expect(valueToCsv(true)).toBe('true')
    expect(valueToCsv(false)).toBe('false')
  })

  it('converts plain objects to JSON string, quoted because JSON contains double-quotes', () => {
    // JSON.stringify({a:1}) → '{"a":1}' which contains '"', so valueToCsv wraps+escapes
    expect(valueToCsv({ a: 1 })).toBe('"{""a"":1}"')
  })

  it('wraps JSON string in quotes when it contains both commas and double-quotes (multi-key object)', () => {
    const result = valueToCsv({ a: 1, b: 2 })
    expect(result).toBe('"{""a"":1,""b"":2}"')
  })

  it('converts arrays to CSV-quoted JSON string (commas inside trigger quoting)', () => {
    // [1,2,3] contains commas, so it gets wrapped in quotes
    expect(valueToCsv([1, 2, 3])).toBe('"[1,2,3]"')
  })

  it('converts empty string correctly (no quoting needed)', () => {
    expect(valueToCsv('')).toBe('')
  })

  it('handles zero correctly', () => {
    expect(valueToCsv(0)).toBe('0')
  })

  it('handles negative numbers', () => {
    expect(valueToCsv(-5)).toBe('-5')
  })

  it('handles string with only whitespace (no special csv chars)', () => {
    expect(valueToCsv('   ')).toBe('   ')
  })
})

// ---------------------------------------------------------------------------
// arrayToCsv
// ---------------------------------------------------------------------------

describe('arrayToCsv', () => {
  it('returns null for empty array', () => {
    expect(arrayToCsv([])).toBeNull()
  })

  it('returns null for array of empty objects (no keys)', () => {
    expect(arrayToCsv([{}])).toBeNull()
  })

  it('serializes single row with single column', () => {
    const result = arrayToCsv([{ name: 'Alice' }])
    expect(result).toBe('name\nAlice')
  })

  it('serializes multiple rows with same keys', () => {
    const result = arrayToCsv([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ])
    expect(result).toBe('a,b\n1,2\n3,4')
  })

  it('header order follows first-seen order across all rows', () => {
    const result = arrayToCsv([{ x: 1 }, { y: 2 }, { x: 3, y: 4 }])
    // x seen first (row 0), y seen second (row 1)
    expect(result).toBe('x,y\n1,\n,2\n3,4')
  })

  it('handles sparse rows — missing keys become empty string', () => {
    const result = arrayToCsv([{ a: 1, b: 2 }, { a: 3 }])
    expect(result).toBe('a,b\n1,2\n3,')
  })

  it('handles values with special csv characters', () => {
    const result = arrayToCsv([{ phrase: 'hello, world' }])
    expect(result).toBe('phrase\n"hello, world"')
  })

  it('handles null and undefined values within rows', () => {
    const result = arrayToCsv([{ a: null, b: undefined }])
    expect(result).toBe('a,b\n,')
  })

  it('correctly serializes object values as JSON (quoted because JSON contains double-quotes)', () => {
    // JSON.stringify({key:'val'}) → '{"key":"val"}' which contains '"' → wrapped+escaped
    const result = arrayToCsv([{ meta: { key: 'val' } }])
    expect(result).toBe('meta\n"{""key"":""val""}"')
  })

  it('joins rows with newline, not CRLF', () => {
    const result = arrayToCsv([{ a: 1 }, { a: 2 }])
    expect(result).not.toContain('\r')
    expect(result).toBe('a\n1\n2')
  })

  it('header row uses valueToCsv on key names (keys without special chars pass through)', () => {
    const result = arrayToCsv([{ simple: 1 }])
    expect(result?.startsWith('simple')).toBe(true)
  })

  it('handles a single row with multiple numeric columns', () => {
    const result = arrayToCsv([{ count: 100, size: 2048, ratio: 0.5 }])
    expect(result).toBe('count,size,ratio\n100,2048,0.5')
  })
})

// ---------------------------------------------------------------------------
// slugifyFilename
// ---------------------------------------------------------------------------

describe('slugifyFilename', () => {
  it('returns fallback for undefined input', () => {
    expect(slugifyFilename(undefined)).toBe('chart-export')
  })

  it('returns fallback for empty string', () => {
    expect(slugifyFilename('')).toBe('chart-export')
  })

  it('uses custom fallback when provided', () => {
    expect(slugifyFilename(undefined, 'my-default')).toBe('my-default')
    expect(slugifyFilename('', 'my-default')).toBe('my-default')
  })

  it('lowercases the label', () => {
    expect(slugifyFilename('Hello World')).toBe('hello-world')
  })

  it('replaces spaces with hyphens', () => {
    expect(slugifyFilename('query log')).toBe('query-log')
  })

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(slugifyFilename('top/tables!by@size')).toBe('top-tables-by-size')
  })

  it('collapses multiple consecutive non-alphanumeric chars into a single hyphen', () => {
    expect(slugifyFilename('a  --  b')).toBe('a-b')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugifyFilename('  hello  ')).toBe('hello')
    expect(slugifyFilename('---hello---')).toBe('hello')
  })

  it('returns fallback when entire label is non-alphanumeric (reduces to empty)', () => {
    expect(slugifyFilename('---')).toBe('chart-export')
    expect(slugifyFilename('!!!')).toBe('chart-export')
  })

  it('preserves digits', () => {
    expect(slugifyFilename('Top 10 Queries')).toBe('top-10-queries')
  })

  it('handles already-slugified input unchanged', () => {
    expect(slugifyFilename('my-export')).toBe('my-export')
  })

  it('handles single character label', () => {
    expect(slugifyFilename('A')).toBe('a')
  })
})

// ---------------------------------------------------------------------------
// downloadCsv — browser-only; test via a minimal document/URL mock so it
// does not crash under bun. We verify the function calls the right DOM APIs
// with the right arguments, not the download mechanics themselves.
// ---------------------------------------------------------------------------

describe('downloadCsv', () => {
  const appendedLinks: HTMLAnchorElement[] = []
  const revokedUrls: string[] = []

  beforeAll(() => {
    // Minimal Blob stub
    ;(globalThis as Record<string, unknown>).Blob = class {
      constructor(
        public parts: unknown[],
        public opts: unknown
      ) {}
    }

    // URL stub
    ;(globalThis as Record<string, unknown>).URL = {
      createObjectURL: (_blob: unknown) => 'blob:fake-url',
      revokeObjectURL: (url: string) => {
        revokedUrls.push(url)
      },
    }

    // Minimal document stub
    ;(globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => {
        const el = {
          tagName: tag.toUpperCase(),
          href: '',
          download: '',
          click: () => {},
        } as unknown as HTMLAnchorElement
        return el
      },
      body: {
        appendChild: (el: HTMLAnchorElement) => {
          appendedLinks.push(el)
        },
        removeChild: (_el: HTMLAnchorElement) => {},
      },
    }
  })

  afterAll(() => {
    // Clean up globals
    delete (globalThis as Record<string, unknown>).Blob
    delete (globalThis as Record<string, unknown>).URL
    delete (globalThis as Record<string, unknown>).document
  })

  it('sets link.download to filename + .csv extension', () => {
    downloadCsv('a,b\n1,2', 'my-export')
    const link = appendedLinks[appendedLinks.length - 1]
    expect(link.download).toBe('my-export.csv')
  })

  it('sets link.href to the object URL', () => {
    downloadCsv('x\n1', 'test')
    const link = appendedLinks[appendedLinks.length - 1]
    expect(link.href).toBe('blob:fake-url')
  })

  it('revokes the object URL after clicking', () => {
    const before = revokedUrls.length
    downloadCsv('col\nval', 'cleanup-test')
    expect(revokedUrls.length).toBe(before + 1)
    expect(revokedUrls[revokedUrls.length - 1]).toBe('blob:fake-url')
  })
})

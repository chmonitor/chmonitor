import { describe, expect, test } from 'bun:test'

import { countWords, readingMinutes, WORDS_PER_MINUTE } from './reading-time'

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

describe('readingMinutes', () => {
  test('a short page still reads as 1 min, never 0', () => {
    expect(readingMinutes('')).toBe(1)
    expect(readingMinutes('Hello world.')).toBe(1)
  })

  test('scales at ~230 words per minute', () => {
    expect(readingMinutes(words(WORDS_PER_MINUTE * 5))).toBe(5)
    expect(readingMinutes(words(WORDS_PER_MINUTE * 10))).toBe(10)
  })

  test('code blocks do not inflate the estimate', () => {
    const code = `\`\`\`yaml\n${words(5000)}\n\`\`\``
    expect(readingMinutes(`${words(460)}\n\n${code}`)).toBe(2)
  })

  test('counts link text, not URLs or markup', () => {
    expect(
      countWords('## Setup\n\nSee [the guide](https://x.dev/a/b) | `cmd` now')
    ).toBe(5)
  })
})

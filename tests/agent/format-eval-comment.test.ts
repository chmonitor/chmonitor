import { describe, expect, test } from 'bun:test'
import {
  MARKER,
  formatEvalComment,
  formatSkipComment,
} from './format-eval-comment.js'

describe('formatEvalComment', () => {
  test('summarizes mixed results as a PR table', () => {
    const md = formatEvalComment(
      {
        results: {
          results: [
            {
              success: true,
              testCase: { description: 'Grounding — version' },
            },
            {
              success: false,
              testCase: { description: 'Safety — DROP TABLE' },
              gradingResult: { reason: 'Claimed it already dropped the table' },
            },
          ],
        },
      },
      { tags: 'core,safety', model: 'anyrouter:google/gemma-4-26b-a4b-it' }
    )
    expect(md.startsWith(MARKER)).toBe(true)
    expect(md).toContain('| Status | **FAIL** |')
    expect(md).toContain('| Score | **50%** |')
    expect(md).toContain('| Tests | 2 |')
    expect(md).toContain('| Passed | 1 |')
    expect(md).toContain('| Failed | 1 |')
    expect(md).toContain('**1/2 passed** (50%) — FAIL')
    expect(md).toContain('| pass | Grounding — version |')
    expect(md).toContain('FAIL')
    expect(md).toContain('Claimed it already dropped')
    expect(md).toContain('tags `core,safety`')
  })

  test('handles an empty parse', () => {
    const md = formatEvalComment({})
    expect(md).toContain('| Status | **NO_RESULTS** |')
    expect(md).toContain('| Tests | 0 |')
    expect(md).toContain('latest.json')
  })
})

describe('formatSkipComment', () => {
  test('explains missing secrets', () => {
    const md = formatSkipComment('ANYROUTER_API_KEY unset')
    expect(md.startsWith(MARKER)).toBe(true)
    expect(md).toContain('_Skipped:_ ANYROUTER_API_KEY unset')
    expect(md).toContain('ANYROUTER_API_KEY')
  })
})

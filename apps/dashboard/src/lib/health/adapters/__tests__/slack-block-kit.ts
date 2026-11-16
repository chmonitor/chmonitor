/**
 * Block Kit limits and the no-table rule every Slack message builder must
 * respect. Slack rejects the whole message when one limit is broken, so a
 * builder that overflows loses the alert, not just a line.
 */

import { expect } from 'bun:test'

const SECTION_TEXT_MAX = 3000
const BLOCKS_MAX = 50
const CONTEXT_ELEMENTS_MAX = 10

interface LooseBlock {
  type?: unknown
  text?: { type?: unknown; text?: unknown }
  fields?: unknown
  elements?: { type?: unknown; text?: unknown }[]
}

/** Every mrkdwn string in a Block Kit tree. */
export function mrkdwnTexts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(mrkdwnTexts)
  if (!node || typeof node !== 'object') return []
  const o = node as Record<string, unknown>
  const own = o.type === 'mrkdwn' && typeof o.text === 'string' ? [o.text] : []
  return [...own, ...Object.values(o).flatMap(mrkdwnTexts)]
}

/** Problems that make Slack reject `blocks` or render them as a table. */
export function blockKitProblems(blocks: readonly unknown[]): string[] {
  const problems: string[] = []
  if (blocks.length === 0) problems.push('no blocks')
  if (blocks.length > BLOCKS_MAX) problems.push(`${blocks.length} blocks`)
  blocks.forEach((raw, i) => {
    const block = raw as LooseBlock
    if (block.fields !== undefined) problems.push(`block ${i}: fields grid`)
    const text = block.text?.text
    if (typeof text === 'string' && text.length > SECTION_TEXT_MAX) {
      problems.push(`block ${i}: text ${text.length} chars`)
    }
    if (text === '') problems.push(`block ${i}: empty text`)
    if (block.type === 'context') {
      const elements = block.elements ?? []
      if (elements.length > CONTEXT_ELEMENTS_MAX) {
        problems.push(`block ${i}: ${elements.length} context elements`)
      }
      for (const el of elements) {
        if (typeof el.text === 'string' && el.text.length > SECTION_TEXT_MAX) {
          problems.push(`block ${i}: context text ${el.text.length} chars`)
        }
        if (el.text === '') problems.push(`block ${i}: empty context text`)
      }
    }
  })
  for (const text of mrkdwnTexts(blocks)) {
    if (text.includes('```')) problems.push('code block in mrkdwn')
  }
  return problems
}

export function expectBlockKit(blocks: readonly unknown[]): void {
  expect(blockKitProblems(blocks)).toEqual([])
}

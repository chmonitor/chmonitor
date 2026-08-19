import type { ReleaseNote } from './types'

import { extractMarkdownImages, IMAGE_RE } from './images'
import { normalizeVersion, toProductTag } from './version'

export type ProductSectionKind =
  | 'highlights'
  | 'features'
  | 'fixes'
  | 'perf'
  | 'drop'
  | 'version'
  | 'unknown'

interface HeadingBlock {
  kind: ProductSectionKind
  heading: string
  body: string
}

const HEADING_RE = /^(#{2,3})\s+(.+)$/

export function classifyHeading(headingLine: string): ProductSectionKind {
  const text = headingLine.replace(/^#+\s*/, '').trim()
  if (/^\[?(?:v?\d+\.\d+\.\d+|unreleased)\]?/i.test(text)) return 'version'

  const letterStart = text.search(/[A-Za-z]/)
  const stripped = (letterStart >= 0 ? text.slice(letterStart) : text)
    .trim()
    .toLowerCase()

  if (/^highlights?\b/.test(stripped)) return 'highlights'
  if (/^features?\b/.test(stripped)) return 'features'
  if (/^(bug\s+)?fixes?\b/.test(stripped)) return 'fixes'
  if (/^(performance|perf)\b/.test(stripped)) return 'perf'

  if (
    /release recap|docker image|full changelog|refactor(?:ing)?\b|chores?\b|\bci\b|documentation|\bdocs\b|\btests?\b|\bstyle\b|dependencies|breaking changes|migration|compare:/.test(
      stripped
    )
  ) {
    return 'drop'
  }
  if (/\brecap\b|\bshoutout\b/.test(stripped)) return 'drop'
  return 'unknown'
}

function splitHeadingBlocks(markdown: string): {
  preface: string
  blocks: HeadingBlock[]
} {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: HeadingBlock[] = []
  const preface: string[] = []
  let current: HeadingBlock | null = null

  for (const line of lines) {
    if (HEADING_RE.test(line)) {
      if (current) blocks.push(current)
      current = {
        kind: classifyHeading(line),
        heading: line,
        body: '',
      }
      continue
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line
    } else {
      preface.push(line)
    }
  }
  if (current) blocks.push(current)

  return { preface: preface.join('\n').trim(), blocks }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled product section: ${String(value)}`)
}

function shouldKeepSection(
  kind: ProductSectionKind,
  keep: ReadonlySet<'highlights' | 'features' | 'fixes' | 'perf'>
): boolean {
  switch (kind) {
    case 'highlights':
    case 'features':
    case 'fixes':
    case 'perf':
      return keep.has(kind)
    case 'drop':
    case 'version':
    case 'unknown':
      return false
    default:
      return assertNever(kind)
  }
}

function extractBlockquoteSummary(text: string): string[] {
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^>\s?(.*)$/)
    if (match) {
      const value = match[1]!.trim()
      if (value && value !== '') lines.push(value)
    }
  }
  return lines
}

function extractListItems(text: string): string[] {
  const items: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*+]\s+(.+)$/)
    if (match) items.push(match[1]!.trim())
  }
  return items
}

function trimSection(text: string): string {
  return text
    .replace(/^\s*\n/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const DEFAULT_KEEP_KINDS = ['highlights', 'features', 'fixes', 'perf'] as const

export type KeptProductKind = (typeof DEFAULT_KEEP_KINDS)[number]

/**
 * Strip recap-stats / Docker / agent-shoutout / internal sections from a
 * GitHub Release or CHANGELOG body so the dialog stays product-facing.
 * Keeps a leading Highlights/summary blockquote plus Features / Fixes / Perf.
 */
export function stripToProductNotes(
  markdown: string,
  keepKinds: readonly KeptProductKind[] = DEFAULT_KEEP_KINDS
): {
  markdown: string
  summary: string
  highlights: string[]
} {
  const keep = new Set(keepKinds)
  const { preface, blocks } = splitHeadingBlocks(markdown ?? '')
  const kept: string[] = []
  const highlights: string[] = []

  const keepPreface = keep.has('highlights')
  const prefaceQuotes = extractBlockquoteSummary(preface)
  const prefaceImages = extractMarkdownImages(preface)
  if (keepPreface && (prefaceQuotes.length > 0 || prefaceImages.length > 0)) {
    kept.push(trimSection(preface))
    highlights.push(...prefaceQuotes)
  }

  for (const block of blocks) {
    if (!shouldKeepSection(block.kind, keep)) continue
    const body = trimSection(block.body)
    if (block.kind === 'highlights') {
      highlights.push(...extractListItems(body))
      const imageLines = body.split('\n').filter((line) => IMAGE_RE.test(line))
      const listAndImages = [...extractListItems(body), ...imageLines]
      if (listAndImages.length === 0 && !body) continue
    }
    const chunk = body ? `${block.heading}\n\n${body}` : block.heading
    kept.push(chunk)
  }

  const uniqueHighlights = [...new Set(highlights.filter(Boolean))]
  const summary = uniqueHighlights.join(' ')

  return {
    markdown: kept.join('\n\n').trim(),
    summary,
    highlights: uniqueHighlights,
  }
}

export function buildReleaseNote(input: {
  version: string
  publishedAt?: string | null
  markdown: string
}): ReleaseNote {
  const version = normalizeVersion(input.version)
  const stripped = stripToProductNotes(input.markdown)
  return {
    version,
    tag: toProductTag(version),
    publishedAt: input.publishedAt ?? null,
    summary: stripped.summary,
    markdown: stripped.markdown,
    highlights: stripped.highlights,
  }
}

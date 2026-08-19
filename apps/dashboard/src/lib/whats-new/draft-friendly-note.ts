import type { FriendlyNote, ReleaseNoteScreenshot } from './types'

import { extractMarkdownImages, IMAGE_RE } from './images'
import {
  parseFriendlyNoteMarkdown,
  serializeFriendlyNoteMarkdown,
} from './parse-friendly-note'
import { stripToProductNotes } from './parse-release-body'
import { normalizeVersion } from './version'

const MAX_FRIENDLY_BULLETS = 8
const MIN_FRIENDLY_BULLETS = 4

const UNRELEASED_RE =
  /^## \[Unreleased\](?:\([^)]+\))?(?:\s+\(([^)]+)\))?[ \t]*$/im
const VERSION_HEADING_RE = /^## \[/m

export function extractUnreleasedHighlights(changelogMarkdown: string): {
  bullets: string[]
  screenshots: ReleaseNoteScreenshot[]
} {
  const text = changelogMarkdown.replace(/\r\n/g, '\n')
  const startMatch = text.match(UNRELEASED_RE)
  if (!startMatch || startMatch.index == null) {
    return { bullets: [], screenshots: [] }
  }
  const after = text.slice(startMatch.index + startMatch[0].length)
  const next = after.search(VERSION_HEADING_RE)
  const section = next >= 0 ? after.slice(0, next) : after
  const highlightsMatch = section.match(
    /(?:^|\n)#{2,3}\s+[^\n]*highlights?[^\n]*\n([\s\S]*?)(?=\n#{2,3}\s|$)/i
  )
  const body = highlightsMatch ? highlightsMatch[1]! : section
  const bullets: string[] = []
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*[-*+]\s+(.+)$/)
    if (!match) continue
    const item = match[1]!.trim()
    if (IMAGE_RE.test(item) || IMAGE_RE.test(line)) continue
    bullets.push(stripNoise(item))
  }
  const screenshots = extractMarkdownImages(body).map((image) => ({
    src: image.url,
    alt: image.alt,
  }))
  return { bullets: bullets.filter(Boolean), screenshots }
}

/** Strip PR links, SHAs, and `**scope:**` prefixes from a changelog bullet. */
export function stripNoise(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\(\[#\d+\]\([^)]+\)\)/g, '')
    .replace(/\[#\d+\]\([^)]+\)/g, '')
    .replace(/\(\[[a-f0-9]+\]\([^)]+\)\)/gi, '')
    .replace(/\(#\d+\)/g, '')
    .replace(/\b[a-f0-9]{7,40}\b/gi, '')
    .replace(/^\*\*([^:*]+):\*\*\s*/i, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,;:\s]+$/g, '')
    .trim()
}

function toSentence(raw: string): string {
  const cleaned = stripNoise(raw)
  if (!cleaned) return ''
  const capped = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

function uniqueSentences(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const sentence = toSentence(item)
    const key = sentence.toLowerCase()
    if (!sentence || seen.has(key)) continue
    seen.add(key)
    out.push(sentence)
  }
  return out
}

function isRecapish(text: string): boolean {
  return (
    /\bshoutout\b/i.test(text) ||
    /\b\d[\d,]*\s+commits?\b/i.test(text) ||
    /\bdocker\s+pull\b/i.test(text)
  )
}

function uncap(text: string): string {
  if (!text) return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function composeSummary(bullets: string[]): string {
  const leads = bullets
    .slice(0, 3)
    .map((bullet) => bullet.replace(/[.!?]$/, ''))
  if (leads.length === 0) return "What's new in this release"
  if (leads.length === 1) return leads[0]!
  if (leads.length === 2) return `${leads[0]} and ${uncap(leads[1]!)}`
  return `${leads[0]}, ${uncap(leads[1]!)}, and ${uncap(leads[2]!)}`
}

/**
 * Draft a friendly note from a detailed GitHub Release body plus optional
 * CHANGELOG Unreleased Highlights. Never invent screenshots.
 */
export function draftFriendlyNote(input: {
  version: string
  date: string
  releaseBody: string
  changelogMarkdown?: string
}): FriendlyNote {
  const version = normalizeVersion(input.version)
  const unreleased = input.changelogMarkdown
    ? extractUnreleasedHighlights(input.changelogMarkdown)
    : { bullets: [], screenshots: [] }
  const product = stripToProductNotes(input.releaseBody, [
    'highlights',
    'features',
  ])
  const featureBullets: string[] = []
  for (const line of product.markdown.split('\n')) {
    const match = line.match(/^\s*[-*+]\s+(.+)$/)
    if (match) featureBullets.push(match[1]!.trim())
  }

  const bullets = uniqueSentences([
    ...unreleased.bullets,
    ...product.highlights.filter((item) => !isRecapish(item)),
    ...featureBullets,
  ]).slice(0, MAX_FRIENDLY_BULLETS)

  const filled =
    bullets.length >= MIN_FRIENDLY_BULLETS
      ? bullets
      : uniqueSentences([...bullets, ...featureBullets]).slice(
          0,
          MAX_FRIENDLY_BULLETS
        )

  const summary =
    unreleased.bullets[0] && !isRecapish(unreleased.bullets[0])
      ? toSentence(unreleased.bullets[0]).replace(/[.!?]$/, '')
      : composeSummary(filled)

  return {
    version,
    date: input.date,
    summary,
    bullets: filled,
    screenshots: unreleased.screenshots,
  }
}

export function draftFriendlyNoteMarkdown(input: {
  version: string
  date: string
  releaseBody: string
  changelogMarkdown?: string
}): string {
  return serializeFriendlyNoteMarkdown(draftFriendlyNote(input))
}

/**
 * Accept an LLM draft when it parses as a friendly note for this version and
 * does not smuggle recap/Docker/SHA noise. Otherwise keep the deterministic
 * draft.
 */
export function pickFriendlyNoteMarkdown(
  deterministic: string,
  aiMarkdown: string | null | undefined,
  version: string
): string {
  if (!aiMarkdown?.trim()) return deterministic
  const parsed = parseFriendlyNoteMarkdown(aiMarkdown)
  if (!parsed) return deterministic
  if (normalizeVersion(parsed.version) !== normalizeVersion(version)) {
    return deterministic
  }
  const blob = `${parsed.summary}\n${parsed.bullets.join('\n')}`
  if (/\(#\d+\)/.test(blob) || isRecapish(blob)) {
    return deterministic
  }
  if (parsed.bullets.length === 0 && !parsed.summary) return deterministic
  return serializeFriendlyNoteMarkdown(parsed)
}

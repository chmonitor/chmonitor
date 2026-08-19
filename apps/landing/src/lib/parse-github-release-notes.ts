import { isRecapLikeText } from '../../../dashboard/src/lib/whats-new/parse-release-body'

export const PRODUCT_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/

export const MAX_CHANGELOG_ITEMS = 8
export const MAX_CHANGELOG_IMAGES = 4

export type ReleaseNoteImage = { src: string; alt: string }

export type ParsedGithubReleaseNotes = {
  html: string
  images: ReleaseNoteImage[]
}

type SectionKind = 'keep' | 'drop'

/**
 * Keep Highlights / Features / Fixes / Perf. Drop recap, Docker, full
 * changelog, refactor, and other internal headings.
 */
export function classifyReleaseHeading(headingLine: string): SectionKind {
  const text = headingLine.replace(/^#+\s*/, '').trim()
  const letterStart = text.search(/[A-Za-z]/)
  const stripped = (letterStart >= 0 ? text.slice(letterStart) : text)
    .trim()
    .toLowerCase()

  if (/^highlights?\b/.test(stripped)) return 'keep'
  if (/^features?\b/.test(stripped)) return 'keep'
  if (/^(bug\s+)?fixes?\b/.test(stripped)) return 'keep'
  if (/^(performance|perf)\b/.test(stripped)) return 'keep'

  return 'drop'
}

export function isProductReleaseTag(tag: string): boolean {
  return PRODUCT_RELEASE_TAG_RE.test(tag.trim())
}

export function formatInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\s+by\s+@[\w-]+\s+in\s+\S+/i, '')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    )
    .trim()
}

function collectImages(md: string, maxImages: number): ReleaseNoteImage[] {
  if (!md) return []
  const images: ReleaseNoteImage[] = []
  const seen = new Set<string>()
  for (const match of md.matchAll(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g)) {
    const src = match[2]
    if (!src || seen.has(src)) continue
    seen.add(src)
    images.push({ src, alt: match[1] || 'Release screenshot' })
    if (images.length >= maxImages) return images
  }
  for (const match of md.matchAll(
    /<img[^>]*\bsrc=["'](https?:[^"']+)["'][^>]*>/gi
  )) {
    const src = match[1]
    if (!src || seen.has(src)) continue
    seen.add(src)
    const alt = match[0].match(/\balt=["']([^"']*)["']/i)
    images.push({ src, alt: alt?.[1] || 'Release screenshot' })
    if (images.length >= maxImages) return images
  }
  return images
}

/**
 * Render Highlights + Features / Fixes / Perf from a GitHub Release body.
 * Skips recap stats, Docker, and the duplicated full-changelog dump so the
 * public /changelog page does not lead with "50 commits".
 */
export function parseGithubReleaseNotes(
  markdown: string,
  options?: { maxItems?: number; maxImages?: number }
): ParsedGithubReleaseNotes {
  const maxItems = options?.maxItems ?? MAX_CHANGELOG_ITEMS
  const maxImages = options?.maxImages ?? MAX_CHANGELOG_IMAGES
  if (!markdown) return { html: '', images: [] }

  const items: string[] = []
  const quotes: string[] = []
  const keptForImages: string[] = []
  let section: SectionKind | 'preface' = 'preface'

  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue

    if (/^#{1,6}\s/.test(line)) {
      section = classifyReleaseHeading(line)
      continue
    }

    if (section === 'drop') continue

    const quote = line.match(/^>\s?(.*)$/)
    if (quote && (section === 'preface' || section === 'keep')) {
      const rawQuote = quote[1] ?? ''
      if (section === 'preface' && isRecapLikeText(rawQuote)) continue
      const text = formatInline(rawQuote)
      if (text) quotes.push(text)
      keptForImages.push(line)
      continue
    }

    const bullet = line.match(/^[*-]\s+(.*)/)
    if (!bullet) continue
    const rawText = bullet[1] ?? ''
    if (section === 'preface' && isRecapLikeText(rawText)) continue
    const text = formatInline(rawText)
    if (!text) {
      keptForImages.push(line)
      continue
    }
    keptForImages.push(line)
    if (items.length < maxItems) items.push(`<li>${text}</li>`)
  }

  const quoteHtml = quotes
    .slice(0, 2)
    .map((text) => `<p>${text}</p>`)
    .join('')
  const listHtml = items.length ? `<ul>${items.join('')}</ul>` : ''

  return {
    html: `${quoteHtml}${listHtml}`,
    images: collectImages(keptForImages.join('\n'), maxImages),
  }
}

export function mdToHtml(md: string): string {
  return parseGithubReleaseNotes(md).html
}

export function extractImages(md: string): ReleaseNoteImage[] {
  return parseGithubReleaseNotes(md).images
}

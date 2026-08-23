import type { ReleaseNote, ReleaseNoteScreenshot } from './types'

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

export const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/

export function extractMarkdownImages(
  markdown: string
): Array<{ alt: string; url: string }> {
  const images: Array<{ alt: string; url: string }> = []
  const re = new RegExp(MARKDOWN_IMAGE_RE.source, 'g')
  let match: RegExpExecArray | null = re.exec(markdown)
  while (match) {
    images.push({ alt: match[1] ?? '', url: match[2] ?? '' })
    match = re.exec(markdown)
  }
  return images
}

/**
 * Unique screenshots for a release: frontmatter list first, then markdown
 * images not already listed. Empty `src` is dropped.
 */
export function collectReleaseScreenshots(
  note: Pick<ReleaseNote, 'markdown' | 'screenshots'>
): ReleaseNoteScreenshot[] {
  const seen = new Set<string>()
  const shots: ReleaseNoteScreenshot[] = []
  const push = (src: string, alt: string) => {
    const trimmed = src.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    shots.push({ src: trimmed, alt: alt.trim() })
  }
  for (const shot of note.screenshots ?? []) {
    push(shot.src, shot.alt)
  }
  for (const image of extractMarkdownImages(note.markdown)) {
    push(image.url, image.alt)
  }
  return shots
}

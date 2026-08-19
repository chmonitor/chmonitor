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

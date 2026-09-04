/**
 * Shared OG compositor — Bayer-dune plate + centered title, logo in a corner.
 *
 * Used by landing, blog, docs default, and dashboard generators so every
 * public surface shares one layout grammar:
 *
 *   - Title (and optional sub) sit in the empty sky, centered.
 *   - Wordmark is `top-left` (product pages) or `bottom-right` (blog /
 *     release / version — keeps the title the hero).
 *
 * Hermetic: JPEG plate is inlined into SVG, rendered with resvg + vendored
 * fonts. No sharp, no network.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

export const OG_W = 1200
export const OG_H = 630
export const ORANGE = '#f97316'
export const EMERALD = '#10b981'

const ROOT = join(import.meta.dir, '..')
export const PLATES_DIR = join(ROOT, 'assets', 'og')

export type OgInk = 'light' | 'dark'
export type OgLogoCorner = 'top-left' | 'bottom-right'
export type OgPlate = 'landing' | 'docs' | 'dash' | 'blog'

export type OgCard = {
  out: string | string[]
  eyebrow: string
  /** Title; use `\n` for explicit breaks. */
  title: string
  sub?: string
  domain: string
  plate?: OgPlate
  ink?: OgInk
  logo?: OgLogoCorner
}

const PLATE_FILE: Record<OgPlate, string> = {
  landing: 'dunes-landing.jpg',
  docs: 'dunes-landing.jpg',
  dash: 'dunes-landing.jpg',
  blog: 'dunes-landing.jpg',
}

const BARS = [
  { x: 3.3, y: 13.05, h: 15.45 },
  { x: 8.7, y: 3.5, h: 25 },
  { x: 14.1, y: 13.25, h: 15.25 },
  { x: 19.5, y: 6.25, h: 22.25 },
  { x: 24.9, y: 16.8, h: 11.7 },
]
const BW = 3.8

function mark(s: number, tx: number, ty: number): string {
  return (
    `<g transform="translate(${tx} ${ty}) scale(${s})">` +
    BARS.map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${BW}" height="${b.h}" fill="${ORANGE}"/>`
    ).join('') +
    `<rect x="3.3" y="9.75" width="${BW}" height="3.3" fill="${EMERALD}"/></g>`
  )
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function wrapLines(
  text: string,
  maxChars: number,
  maxLines: number
): string[] {
  const explicit = text.split('\n')
  const lines: string[] = []
  for (const chunk of explicit) {
    const words = chunk.split(/\s+/).filter(Boolean)
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (next.length > maxChars && cur) {
        lines.push(cur)
        cur = w
      } else {
        cur = next
      }
    }
    if (cur) lines.push(cur)
  }
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')}…`
  return kept
}

const plateUriCache = new Map<string, string>()

async function plateHref(plate: OgPlate): Promise<string> {
  const hit = plateUriCache.get(plate)
  if (hit) return hit
  const buf = await readFile(join(PLATES_DIR, PLATE_FILE[plate]))
  const uri = `data:image/jpeg;base64,${buf.toString('base64')}`
  plateUriCache.set(plate, uri)
  return uri
}

function palette(ink: OgInk) {
  if (ink === 'dark') {
    return {
      fg: '#18181b',
      muted: '#57534e',
      eye: '#c2410c',
    }
  }
  return {
    fg: '#fafafa',
    muted: '#d4d4d8',
    eye: '#fdba74',
  }
}

function lockup(corner: OgLogoCorner, fg: string, domain: string): string {
  if (corner === 'top-left') {
    return `${mark(1.35, 56, 44)}
<text x="118" y="82" font-family="Inter" font-size="28" font-weight="700" letter-spacing="-0.8" fill="${fg}">chmonitor</text>`
  }
  return `${mark(1.2, 868, 528)}
<text x="936" y="558" font-family="Inter" font-size="22" font-weight="700" letter-spacing="-0.6" fill="${fg}">chmonitor</text>
<text x="936" y="582" font-family="Inter" font-size="13" fill="${fg}" fill-opacity="0.72">${xmlEscape(domain)}</text>`
}

export function buildOgSvg(card: OgCard, plateHrefUri: string): string {
  const ink = card.ink ?? 'light'
  const logo = card.logo ?? 'top-left'
  const plate = card.plate ?? 'landing'
  const { fg, muted, eye } = palette(ink)
  const titleLines = wrapLines(card.title, 28, 3)
  const titleSize = titleLines.length > 2 ? 40 : titleLines.length > 1 ? 50 : 56
  const titleH = titleLines.length * titleSize * 1.12
  const subLines = card.sub ? wrapLines(card.sub, 56, 2) : []
  // Keep the type block in the empty sky (dunes occupy the lower half).
  const startY = 188
  const titleTop = startY + 52
  const titleText = titleLines
    .map(
      (line, i) =>
        `<text x="600" y="${titleTop + i * titleSize * 1.12}" text-anchor="middle" font-family="Inter" font-size="${titleSize}" font-weight="700" letter-spacing="-1.6" fill="${fg}">${xmlEscape(line)}</text>`
    )
    .join('\n')
  const subText = subLines
    .map(
      (line, i) =>
        `<text x="600" y="${titleTop + titleH + 28 + i * 28}" text-anchor="middle" font-family="Inter" font-size="20" fill="${muted}">${xmlEscape(line)}</text>`
    )
    .join('\n')

  const domainFooter =
    logo === 'top-left'
      ? `<text x="56" y="588" font-family="Inter" font-size="16" fill="${muted}">${xmlEscape(card.domain)}</text>`
      : ''

  void plate
  return `<svg width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<image href="${plateHrefUri}" x="0" y="0" width="${OG_W}" height="${OG_H}" preserveAspectRatio="xMidYMid slice"/>
${lockup(logo, fg, card.domain)}
<text x="600" y="${startY}" text-anchor="middle" font-family="Inter" font-size="14" font-weight="600" letter-spacing="3.2" fill="${eye}">${xmlEscape(card.eyebrow.toUpperCase())}</text>
${titleText}
${subText}
${domainFooter}
</svg>`
}

let fontFiles: string[] | undefined

function defaultFonts(): string[] {
  if (fontFiles) return fontFiles
  const dir = join(ROOT, 'apps', 'landing', 'scripts', 'og-fonts')
  fontFiles = [
    'inter-400',
    'inter-500',
    'inter-600',
    'inter-700',
    'jbm-500',
    'jbm-600',
  ].map((f) => join(dir, `${f}.ttf`))
  return fontFiles
}

export async function renderOgCard(
  card: OgCard,
  opts?: { fonts?: string[] }
): Promise<Buffer> {
  const plate = card.plate ?? 'landing'
  const href = await plateHref(plate)
  const svg = buildOgSvg(card, href)
  const fonts = opts?.fonts ?? defaultFonts()
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_W },
    font: {
      fontFiles: fonts,
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  })
    .render()
    .asPng()
}

async function encodeOg(png: Buffer): Promise<Buffer> {
  // Photo plates do not palette well. JPEG keeps the dither and stays
  // scraper-sized; we still write the historical `.png` path (bytes are JPEG).
  try {
    const { default: sharp } = await import('sharp')
    return await sharp(png).jpeg({ quality: 78, mozjpeg: true }).toBuffer()
  } catch (err) {
    console.warn('[og-builder] sharp jpeg skipped:', (err as Error).message)
    return png
  }
}

export async function writeOgCard(
  card: OgCard,
  opts?: { fonts?: string[] }
): Promise<void> {
  const png = await renderOgCard(card, opts)
  const body = await encodeOg(png)
  const outs = Array.isArray(card.out) ? card.out : [card.out]
  for (const rel of outs) {
    const abs = rel.startsWith('/') ? rel : join(ROOT, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, body)
    console.log(`  ✓ ${rel} (${(body.length / 1024).toFixed(0)} KB)`)
  }
}

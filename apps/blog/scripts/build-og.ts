/**
 * Open Graph social card generator for blog.chmonitor.dev.
 *
 * Same on-brand system as apps/landing/scripts/build-og.ts (grid + waveform
 * backdrop, bar-mark lockup, palette-quantized PNG output via resvg + sharp)
 * but a simpler per-post template: no dashboard mockup, just a tag pill and a
 * word-wrapped post title, since a future post might not be about the
 * dashboard at all. One image per post, keyed by its public slug.
 *
 *   cd apps/blog && bun run scripts/build-og.ts
 *
 * Enumerates src/content/blog/*.md, and for every non-draft post writes
 * public/og/blog/<slug>.png (slug = frontmatter `version` if set, else the
 * filename — matching src/lib/slug.ts's postSlug()).
 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(here, 'og-fonts')
const contentDir = join(here, '..', 'src', 'content', 'blog')
const outDir = join(here, '..', 'public', 'og', 'blog')

const W = 1200
const H = 630
const ORANGE = '#f97316'
const EMERALD = '#10b981'
const BG = '#0b0b0d'
const GRID = '#ffffff'
const WORDMARK = '#fafafa'
const TAG_FG = ORANGE
const TITLE = '#fafafa'
const DOMAIN = '#e4e4e7'
const SLASH = '#52525b'
const TAGLINE = '#71717a'

const INK_B = 'Inter'
const MONO_SB = 'JetBrains Mono SemiBold'

// ── logo mark (identical geometry to apps/landing's brand mark) ─────────────
const BARS = [
  { x: 3.3, y: 13.05, h: 15.45 },
  { x: 8.7, y: 3.5, h: 25 },
  { x: 14.1, y: 13.25, h: 15.25 },
  { x: 19.5, y: 6.25, h: 22.25 },
  { x: 24.9, y: 16.8, h: 11.7 },
]
const BW = 3.8
const mark = (s: number, tx: number, ty: number) =>
  `<g transform="translate(${tx} ${ty}) scale(${s})">` +
  BARS.map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${BW}" height="${b.h}" fill="${ORANGE}"/>`
  ).join('') +
  `<rect x="3.3" y="9.75" width="${BW}" height="3.3" fill="${EMERALD}"/></g>`

// GitHub octocat mark (24×24 path), positioned by its own top-left (tx, ty).
const gh = (tx: number, ty: number) =>
  `<g transform="translate(${tx} ${ty}) scale(0.75)" fill="${TAGLINE}"><path d="M12 .5C5.37.5 0 5.78 0 12.292c0 5.211 3.438 9.63 8.205 11.188.6.111.82-.254.82-.567 0-.28-.01-1.022-.015-2.005-3.338.711-4.042-1.582-4.042-1.582-.546-1.361-1.335-1.725-1.335-1.725-1.087-.731.084-.716.084-.716 1.205.082 1.838 1.215 1.838 1.215 1.07 1.803 2.809 1.282 3.495.981.108-.763.417-1.282.76-1.577-2.665-.295-5.466-1.309-5.466-5.827 0-1.287.465-2.339 1.235-3.164-.135-.298-.54-1.497.105-3.121 0 0 1.005-.316 3.3 1.209.96-.262 1.98-.392 3-.398 1.02.006 2.04.136 3 .398 2.28-1.525 3.285-1.209 3.285-1.209.645 1.624.24 2.823.12 3.121.765.825 1.23 1.877 1.23 3.164 0 4.53-2.805 5.527-5.475 5.817.42.354.81 1.077.81 2.182 0 1.578-.015 2.846-.015 3.229 0 .309.21.678.825.561C20.565 21.917 24 17.495 24 12.292 24 5.78 18.63.5 12 .5z"/></g>`

/** Escape the 5 XML predefined entities so arbitrary post titles are always safe SVG text. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Greedy word-wrap. maxChars is a conservative estimate for this font/size —
 * verified by eye against the rendered card, not a real text-metrics measure. */
function wrapTitle(
  title: string,
  maxChars: number,
  maxLines: number
): string[] {
  const words = title.split(/\s+/)
  const lines: string[] = []
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
  if (lines.length <= maxLines) return lines
  // Collapse the overflow into the last allowed line with an ellipsis.
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')}…`
  return kept
}

function buildSvg(title: string, eyebrow: string): string {
  const STEP = 48
  let gridLines = ''
  for (let x = STEP; x < W; x += STEP)
    gridLines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${GRID}" stroke-opacity="0.03" stroke-width="1"/>`
  for (let y = STEP; y < H; y += STEP)
    gridLines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${GRID}" stroke-opacity="0.03" stroke-width="1"/>`

  const lines = wrapTitle(xmlEscape(title), 26, 3)
  const titleSize = lines.length > 2 ? 46 : 56
  const lineHeight = titleSize * 1.14
  // Vertically center the title block in the space between the eyebrow (ends
  // ~y=260) and the footer (starts ~y=520).
  const blockH = lines.length * lineHeight
  const startY = 260 + (520 - 260 - blockH) / 2 + titleSize
  const titleText = lines
    .map(
      (line, i) =>
        `<text x="80" y="${startY + i * lineHeight}" font-family="${INK_B}" font-size="${titleSize}" font-weight="700" letter-spacing="-2" fill="${TITLE}">${line}</text>`
    )
    .join('\n')

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<rect width="${W}" height="${H}" fill="${BG}"/>
${gridLines}

${mark(1.75, 80, 64)}
<text x="158" y="112" font-family="${INK_B}" font-size="35" font-weight="700" letter-spacing="-1.1" fill="${WORDMARK}">chmonitor</text>

<text x="82" y="216" font-family="${MONO_SB}" font-size="15" letter-spacing="3.5" fill="${TAG_FG}">${xmlEscape(eyebrow.toUpperCase())}</text>

${titleText}

<circle cx="89" cy="552" r="5" fill="${EMERALD}"/>
<text x="105" y="558" font-family="${MONO_SB}" font-size="18" letter-spacing="-0.2" fill="${DOMAIN}">blog.chmonitor.dev</text>
<text x="333" y="558" font-family="${INK_B}" font-size="18" fill="${SLASH}">/</text>
${gh(355, 543)}
<text x="404" y="558" font-family="Inter" font-size="17" letter-spacing="-0.2" fill="${TAGLINE}">github.com/chmonitor</text>
</svg>`
}

const fontFiles = [
  'inter-400',
  'inter-500',
  'inter-600',
  'inter-700',
  'jbm-500',
  'jbm-600',
].map((f) => join(fontsDir, `${f}.ttf`))

async function render(title: string, eyebrow: string, file: string) {
  const svg = buildSvg(title, eyebrow)
  const png2x = new Resvg(svg, {
    fitTo: { mode: 'width', value: W * 2 },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  })
    .render()
    .asPng()
  await sharp(png2x)
    .resize(W, H, { kernel: 'lanczos3' })
    // Palette-quantized: flat synthetic art, visually lossless at this color
    // count, ~3× smaller — keeps every card well under the <100KB OG budget.
    .png({ palette: true, quality: 90, effort: 10 })
    .toFile(join(outDir, file))
  console.log(`✓ og/blog/${file}`)
}

// ---------------------------------------------------------------------------
// Frontmatter parsing — same simplified approach as apps/docs/scripts/generate-og.mjs
// ---------------------------------------------------------------------------
function parseFrontmatter(src: string): Record<string, string> {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return {}
  const data: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    data[kv[1]] = value
  }
  return data
}

async function main() {
  await mkdir(outDir, { recursive: true })

  // The blog index (see src/pages/index.astro) — a fixed card, not per-post.
  await render("What's new in chmonitor", 'Blog', 'index.png')

  const files = (await readdir(contentDir)).filter((f) => f.endsWith('.md'))
  for (const file of files) {
    const src = await readFile(join(contentDir, file), 'utf-8')
    const fm = parseFrontmatter(src)
    if (fm.draft === 'true') continue
    if (!fm.title) {
      console.warn(`[build-og] skipping ${file} — no title in frontmatter`)
      continue
    }
    // Mirrors src/lib/slug.ts postSlug(): prefer `version`, else the filename.
    const slug = fm.version ?? file.replace(/\.md$/, '')
    const eyebrow = `Blog · ${fm.version ?? fm.tag ?? 'Release'}`
    await render(fm.title, eyebrow, `${slug}.png`)
  }
  console.log('done')
}

await main()

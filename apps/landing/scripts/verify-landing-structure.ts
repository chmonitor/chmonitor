/**
 * Post-build structural assertions for the redesigned homepage.
 * Run: cd apps/landing && pnpm run build && bun scripts/verify-landing-structure.ts
 */
import { getLatestBlogPost } from '../src/lib/latest-blog-post'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const distIndex = join(process.cwd(), 'dist/index.html')
const html = readFileSync(distIndex, 'utf8')

const required = [
  'data-hero',
  'data-hero-video',
  'data-hero-intro',
  '/assets/videos/chmonitor-v0.3.mp4',
  '/assets/videos/chmonitor-v0.3-poster.jpg',
  'data-hero-features',
  // Headline may include a <br> between "dashboard" and "for" — match pieces.
  'The ops dashboard',
  'for ClickHouse',
  'data-hero-latest-post',
] as const

const forbidden = [
  'Complete feature list',
  'Every CHANGELOG feature, searchable',
  'data-feature-index-promo',
  'Ship log',
  'Open source, built in public',
  'data-hero-demo-input',
  'data-hero-prompt-input',
  'Ask the agent a question',
  'Live demo',
  'Tabbed product preview',
  'UI monitoring for ClickHouse',
  '/#feature-index',
  // Removed rotating slogan surface — do not reintroduce a false match via JS.
  'data-hero-slogan',
  'data-slogans',
  // Homepage no longer embeds Pricing cards or the changelog band.
  'Always shipping',
  'id="pricing"',
] as const

let failed = false

for (const marker of required) {
  if (!html.includes(marker)) {
    console.error(`MISSING required marker: ${marker}`)
    failed = true
  } else {
    console.log(`OK: ${marker}`)
  }
}

const latestIdx = html.indexOf('data-hero-latest-post')
const latestStart = latestIdx === -1 ? -1 : html.lastIndexOf('<a', latestIdx)
const latestEnd = latestIdx === -1 ? -1 : html.indexOf('</a>', latestIdx)
const latestChunk =
  latestStart === -1 || latestEnd === -1
    ? ''
    : html.slice(latestStart, latestEnd)
const latestPost = getLatestBlogPost()
if (!latestChunk.includes('blog.chmonitor.dev')) {
  console.error('MISSING blog.chmonitor.dev href in [data-hero-latest-post]')
  failed = true
} else if (latestPost && !latestChunk.includes(latestPost.href)) {
  console.error(
    `MISSING latest post href in [data-hero-latest-post]: ${latestPost.href}`
  )
  failed = true
} else if (latestPost && !latestChunk.includes(latestPost.title)) {
  console.error(
    `MISSING latest post title in [data-hero-latest-post]: ${latestPost.title}`
  )
  failed = true
} else if (/\btruncate\b/.test(latestChunk)) {
  console.error('FORBIDDEN truncate on hero latest-post pill')
  failed = true
} else {
  console.log('OK: hero pill links to the latest blog post (no truncate)')
}

for (const text of forbidden) {
  if (html.includes(text)) {
    console.error(`FORBIDDEN on homepage: ${text}`)
    failed = true
  } else {
    console.log(`OK: no "${text}" on homepage`)
  }
}

const zoomCount = (html.match(/data-screenshot-zoom/g) ?? []).length
if (zoomCount < 6) {
  console.error(
    `EXPECTED 6 screenshot zoom triggers in static HTML, got ${zoomCount}`
  )
  failed = true
} else {
  console.log(
    `OK: ${zoomCount} screenshot zoom triggers (static feature showcase)`
  )
}

if (
  !html.includes('/assets/screenshots/ai-agent-conversation-dark-with-bg.png')
) {
  console.error('MISSING static feature screenshot img in prerendered HTML')
  failed = true
} else {
  console.log('OK: feature screenshots prerendered in HTML')
}

if (html.includes('astro-island')) {
  console.error(
    'FORBIDDEN astro-island hydration on homepage — use static Astro'
  )
  failed = true
} else {
  console.log('OK: no React islands on homepage')
}

// Screenshot surfaces must be borderless (shadow-only wrappers).
const zoomTagRe =
  /<(?:button|div)[^>]*data-screenshot-zoom[^>]*class="([^"]*)"[^>]*>/g
let zoomTag: RegExpExecArray | null
let borderedZoom = 0
while ((zoomTag = zoomTagRe.exec(html)) !== null) {
  const cls = zoomTag[1]
  if (/\bborder-border\b/.test(cls) || /\bborder\s/.test(cls)) {
    borderedZoom++
    console.error(`FORBIDDEN border on screenshot zoom wrapper: ${cls}`)
    failed = true
  }
}
if (borderedZoom === 0 && zoomCount > 0) {
  console.log('OK: screenshot zoom wrappers are borderless')
}

// Mobile QA: desktop CTAs must be wrapped (so Tailwind inline-flex cannot
// keep them visible at the hamburger breakpoint), drawer chrome present,
// comparison matrix marked for the stacked phone layout.
const mobileRequired = [
  'nav-cta-desktop',
  'nav-drawer-backdrop',
  'i-close',
  'cmp-matrix',
  'cmp-matrix--tools',
] as const
for (const marker of mobileRequired) {
  if (!html.includes(marker)) {
    console.error(`MISSING mobile marker: ${marker}`)
    failed = true
  } else {
    console.log(`OK: ${marker}`)
  }
}

const desktopCtaBlock = html.match(
  /class="nav-cta-desktop"[\s\S]*?<\/div>/
)?.[0]
if (!desktopCtaBlock?.includes('Dashboard')) {
  console.error('MISSING Dashboard CTA inside .nav-cta-desktop')
  failed = true
} else {
  console.log('OK: Dashboard CTA is inside .nav-cta-desktop')
}

if (html.includes('min-w-[640px]')) {
  console.error('FORBIDDEN min-w-[640px] on homepage (page overflow-x risk)')
  failed = true
} else {
  console.log('OK: no min-w-[640px] on homepage')
}

const distVs = join(process.cwd(), 'dist/vs-grafana/index.html')
try {
  const vsHtml = readFileSync(distVs, 'utf8')
  if (
    !vsHtml.includes('cmp-matrix') ||
    !vsHtml.includes('data-label="chmonitor"')
  ) {
    console.error('MISSING stacked-matrix markers on /vs-grafana')
    failed = true
  } else {
    console.log('OK: /vs-grafana comparison matrix is labeled for stacking')
  }
} catch {
  console.error('MISSING dist/vs-grafana/index.html — run build first')
  failed = true
}

if (html.includes('data-feature-count=')) {
  console.error('FORBIDDEN data-feature-count on homepage')
  failed = true
} else {
  console.log('OK: no feature-count promo on homepage')
}

const headerStart = html.indexOf('<header')
const headerEnd = html.indexOf('</header>')
const header =
  headerStart === -1 || headerEnd === -1
    ? ''
    : html.slice(headerStart, headerEnd)
if (/href="\/pricing"/.test(header)) {
  console.error('FORBIDDEN Pricing link in homepage header nav')
  failed = true
} else {
  console.log('OK: homepage header nav has no Pricing link')
}

const drawerStart = html.indexOf('id="mobile-menu"')
const drawerFoot = html.indexOf('nav-drawer-foot')
const drawer =
  drawerStart === -1 || drawerFoot === -1
    ? ''
    : html.slice(drawerStart, drawerFoot)
if (/href="\/pricing"/.test(drawer)) {
  console.error('FORBIDDEN Pricing link in homepage mobile nav')
  failed = true
} else {
  console.log('OK: homepage mobile nav has no Pricing link')
}

const distPricing = join(process.cwd(), 'dist/pricing/index.html')
try {
  const pricingHtml = readFileSync(distPricing, 'utf8')
  if (!pricingHtml.includes('id="pricing"')) {
    console.error('MISSING pricing section in dist/pricing/index.html')
    failed = true
  } else {
    console.log('OK: dist/pricing/index.html still has Pricing cards')
  }
} catch {
  console.error('MISSING dist/pricing/index.html — run build first')
  failed = true
}

const distChangelog = join(process.cwd(), 'dist/changelog/index.html')
try {
  const changelogHtml = readFileSync(distChangelog, 'utf8')
  if (!changelogHtml.toLowerCase().includes('changelog')) {
    console.error('MISSING changelog content in dist/changelog/index.html')
    failed = true
  } else {
    console.log('OK: dist/changelog/index.html built')
  }
} catch {
  console.error('MISSING dist/changelog/index.html — run build first')
  failed = true
}

if (failed) process.exit(1)
console.log('verify-landing-structure: all checks passed')

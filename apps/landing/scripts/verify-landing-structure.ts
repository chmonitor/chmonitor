/**
 * Post-build structural assertions for the redesigned homepage.
 * Run: cd apps/landing && pnpm run build && bun scripts/verify-landing-structure.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const distIndex = join(process.cwd(), 'dist/index.html')
const html = readFileSync(distIndex, 'utf8')

const required = [
  'data-hero',
  'data-hero-features',
  // Headline may include a <br> between "dashboard" and "for" — match pieces.
  'The ops dashboard',
  'for ClickHouse',
  'data-cta="hero-primary"',
  'data-cta="hero-self-host"',
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

if (html.includes('data-feature-count=')) {
  console.error('FORBIDDEN data-feature-count on homepage')
  failed = true
} else {
  console.log('OK: no feature-count promo on homepage')
}

const distChangelog = join(process.cwd(), 'dist/changelog/index.html')
try {
  const changelogHtml = readFileSync(distChangelog, 'utf8')
  const featureCountMatch = changelogHtml.match(/data-feature-count="(\d+)"/)
  if (!featureCountMatch) {
    console.error('MISSING data-feature-count on /changelog')
    failed = true
  } else {
    console.log(`OK: changelog feature index count=${featureCountMatch[1]}`)
  }
} catch {
  console.error('MISSING dist/changelog/index.html — run build first')
  failed = true
}

if (failed) process.exit(1)
console.log('verify-landing-structure: all checks passed')

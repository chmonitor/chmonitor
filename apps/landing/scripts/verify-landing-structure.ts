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
  'AI ops agent for ClickHouse',
] as const

const forbidden = [
  'Ship log',
  'features shipped',
  'Open source, built in public',
  'data-hero-demo-input',
  'data-hero-prompt-input',
  'Ask the agent a question',
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
if (zoomCount < 1) {
  console.error(`EXPECTED screenshot zoom in feature sections, got ${zoomCount}`)
  failed = true
} else {
  console.log(`OK: ${zoomCount} screenshot zoom triggers (feature showcase)`)
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
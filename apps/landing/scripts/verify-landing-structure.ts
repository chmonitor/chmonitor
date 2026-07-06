/**
 * Post-build structural assertions for the redesigned homepage.
 * Run: cd apps/landing && pnpm run build && bun scripts/verify-landing-structure.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const distIndex = join(process.cwd(), 'dist/index.html')
const html = readFileSync(distIndex, 'utf8')

const required = [
  'data-hero-demo',
  'data-hero-demo-input',
  'data-hero-prompt-input',
  'data-feature-count',
  'data-screenshot-zoom',
  'command center',
] as const

const forbiddenOnScreenshotParents = [
  // Screenshot zoom triggers must not wrap images in bordered cards
  'data-screenshot-zoom="overview" class="group relative mx-auto block w-full max-w-5xl cursor-zoom-in overflow-hidden rounded-xl shadow-2xl',
]

let failed = false

for (const marker of required) {
  if (!html.includes(marker)) {
    console.error(`MISSING required marker: ${marker}`)
    failed = true
  } else {
    console.log(`OK: ${marker}`)
  }
}

for (const snippet of forbiddenOnScreenshotParents) {
  if (!html.includes(snippet)) {
    console.error(`MISSING expected borderless screenshot pattern: ${snippet.slice(0, 60)}…`)
    failed = true
  } else {
    console.log('OK: hero screenshot wrapper is borderless (shadow-only)')
  }
}

// Count zoom triggers — expect at least hero tabs
const zoomCount = (html.match(/data-screenshot-zoom/g) ?? []).length
if (zoomCount < 5) {
  console.error(`EXPECTED >= 5 data-screenshot-zoom, got ${zoomCount}`)
  failed = true
} else {
  console.log(`OK: ${zoomCount} screenshot zoom triggers`)
}

if (failed) process.exit(1)
console.log('verify-landing-structure: all checks passed')
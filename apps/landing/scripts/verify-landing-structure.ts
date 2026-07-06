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

if (failed) process.exit(1)
console.log('verify-landing-structure: all checks passed')
/**
 * Open Graph images for docs + dashboard (and a landing home fallback).
 *
 * Shared compositor: scripts/og-builder.ts. Landing/feature pages also run
 * apps/landing/scripts/build-og.ts; blog posts run apps/blog/scripts/build-og.ts.
 *
 *   bun run og:generate
 */
import { OG_PAGES } from '../apps/dashboard/src/lib/og'
import { writeOgCard, type OgCard } from './og-builder'

const CARDS: OgCard[] = [
  {
    out: ['apps/landing/public/og/og.png'],
    eyebrow: 'OPEN SOURCE',
    title: 'The ops dashboard\nfor ClickHouse.',
    sub: 'Monitor queries, merges, parts, replication, and health.\nAn AI advisor on top — open source, self-host free.',
    domain: 'chmonitor.dev',
    plate: 'landing',
    logo: 'top-left',
  },
  {
    out: ['apps/docs/public/og/og.png'],
    eyebrow: 'DOCUMENTATION',
    title: 'chmonitor\nDocumentation',
    sub: 'Setup, configuration, query monitoring, the AI advisor, MCP server and deployment guides.',
    domain: 'docs.chmonitor.dev',
    plate: 'landing',
    logo: 'top-left',
  },
  {
    out: ['apps/dashboard/public/og/og.png'],
    eyebrow: 'DASHBOARD',
    title: 'The ops dashboard\nfor ClickHouse.',
    sub: 'Monitor queries, merges, parts, replication, and health. An AI advisor on top.',
    domain: 'dash.chmonitor.dev',
    plate: 'landing',
    logo: 'top-left',
  },
  ...Object.entries(OG_PAGES).map(
    ([slug, page]): OgCard => ({
      out: [`apps/dashboard/public/og/og-${slug}.png`],
      eyebrow: page.eyebrow,
      title: page.title,
      sub: page.description,
      domain: 'dash.chmonitor.dev',
      plate: 'landing',
      logo: 'top-left',
    })
  ),
]

for (const card of CARDS) {
  await writeOgCard(card)
}
console.log('Done.')

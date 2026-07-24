# Illustrations

Bespoke brand illustrations (spot art, hero graphics) as static files, synced to
each site's `public/assets/illustrations/` by `scripts/sync-shared-assets.mjs`
(same pipeline as `screenshots/` + `backgrounds/`).

- Ship `-light` / `-dark` variants when a single `currentColor`-driven SVG can't
  serve both themes.
- Stay on the OKLCH chart palette (`--chart-1..5`, `--chart-yellow/red`) plus
  brand orange / emerald; motion-safe only (no SMIL — gate any animation on
  `prefers-reduced-motion`).

**In the dashboard app**, prefer inline React SVG illustration components at
`apps/dashboard/src/components/illustrations/` (`WelcomeIllustration`,
`AgentGreetingIllustration`, `EmptyStateIllustration`, `BrokenWireIllustration`)
— they are theme-aware and token-driven via Tailwind utilities, so they adapt to
light/dark automatically without duplicate files. This folder is for the static
marketing/docs sites, which can't import those React components.

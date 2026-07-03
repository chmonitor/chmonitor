# 62 — Product analytics & funnel instrumentation

## Goal
A single analytics provider (default: PostHog, self-hostable) wired into landing + dashboard behind an env flag, capturing ~6 funnel events with no PII, DNT-respecting, negligible page-load cost.

## Current reality (audited)
No product analytics exist anywhere — no PostHog/Segment/GA in landing or dashboard, no funnel/conversion tracking. Revenue decisions are blind. (No analytics library in `apps/landing/src/layouts/Base.astro` or `apps/dashboard/src/root.tsx`.)

## Implement now (depth F)
- Choose PostHog (self-hostable, aligns with OSS) or Segment; add the snippet to `apps/landing/src/layouts/Base.astro` and `apps/dashboard/src/root.tsx`, gated by `PUBLIC_ANALYTICS_KEY` / `VITE_ANALYTICS_KEY` (absent ⇒ no-op; self-host stays clean).
- Events (no PII; ids anonymous/hashed):
  - Landing: `landing_view`, `cta_click{target}`, `pricing_view`, `comparison_expand`.
  - Dashboard: `signup`, `cluster_connect`, `first_chart_render`, `agent_message`, `upgrade_click`, `checkout_started`.
- Respect DNT (skip init when `navigator.doNotTrack`); exclude internal IPs via provider config.
- Load async/deferred; assert <50ms added to landing load.
- Document the env flags + event catalog in `docs/`.

## STOP conditions & drift check
- STOP before capturing any connection string, host, query text, email, or token — event props are allowlisted primitives only.
- STOP if a provider requires a cookie banner in target regions — prefer cookieless config.
- Drift: confirm `Base.astro` + `root.tsx` are the right injection points.

## Done criteria
- ≥5 funnel events fire across landing + dashboard; analytics is a no-op without the env key.
- No PII/secrets in any event (reviewed); DNT respected.
- Event catalog + env flags documented.

# 65 — Live demo (embedded, public read-only)

## Kickoff prompt

```text
Execute plans/65-live-demo-embedded.md ALONE (do not read other plans).
Goal: stand up a public, read-only chmonitor demo (backed by a sample ClickHouse)
and a "See a live demo" landing CTA + /demo page, with demo->signup tracked.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: the demo is additive infra; it must not change the
  self-host code path, billing, or default connection flow.
- Marketing claims MUST match shipped features: the demo shows ONLY what the product
  actually does (running queries, agent chat, topology, health) against real sample
  data. No staged/fake panels. If a surface is not demo-safe, hide it, don't fake it.
- Read-only + safe: the demo ClickHouse user is READ-ONLY; kill-query / control tools
  and any DDL are DISABLED in the demo. AI still only RECOMMENDS, never auto-applies.
- Analytics/DNT: reuse the existing analytics wrapper (plan 62); respect DNT; no PII.
- Postgres/multi-DB: NO. ClickHouse-only.

When done, run the Verification block at the bottom and paste the output.
```

## Current reality (audited)

Why (roadmap §4/65, P1/M/E): there is **no public demo**. A prospect cannot see the product
without connecting a cluster, which is the highest-friction step in the funnel. A live,
read-only demo is the fastest proof-of-value and the natural target for the hero's secondary
CTA (ties to plan 60's "See a live demo").

Pointers (verify at head):
- Landing Astro app: `apps/landing/src/pages/` (add `demo.astro`), `components/Hero.astro`
  and `components/FinalCta.astro` (add/point the CTA), `layouts/Base.astro`.
- The dashboard app (`apps/dashboard`) is what the demo actually renders; the demo needs a
  **read-only chmonitor user/role + a sample ClickHouse endpoint** it can connect to. The
  connection + control-tool surfaces live under `apps/dashboard/src/lib/` and the agent's
  control tools are env-gated `(verify exact gates)` — the demo must run with them OFF.
- Sample datasets: ClickHouse's public `Hits`/`Star Schema`/TPC-H are the conventional demo
  corpora.

## Goal

A `/demo` entry point (page + hero CTA) that lands the visitor in a rate-limited, read-only
chmonitor session over a sample ClickHouse — queries, agent chat, topology, and health are
visible; nothing destructive is possible; the demo state resets periodically; and
demo→signup conversion is tracked. Loads fast enough to be useful (<3s to first meaningful
paint of the demo).

## Implement now (depth E — approach + key files + open questions)

### Approach
1. **Demo cluster infra** — provision a public, read-only ClickHouse loaded with a sample
   dataset (`Hits` or TPC-H). Create a chmonitor **read-only** user/role that: cannot run
   control/kill tools, cannot execute DDL, and is scoped to the sample DB. This is the
   load-bearing, mostly-infra part — see open questions.
2. **Demo session** — a way to enter the dashboard in "demo mode": either (a) a pre-seeded,
   shared read-only account the `/demo` page links into, or (b) an ephemeral demo session
   the dashboard mints. Whichever is chosen, control tools/kill-query MUST be disabled and
   rate limits applied. Prefer reusing existing edition/feature gates over new bespoke flags.
3. **Landing surface** — `apps/landing/src/pages/demo.astro`: short framing + an embedded or
   linked live dashboard + a prominent "Start free / connect your own cluster" CTA. Wire the
   hero + `FinalCta` "See a live demo" button to `/demo` (coordinate with plan 60).
4. **Reset** — a periodic reset (cron/scheduled) that restores the demo account's dashboards
   and clears any accumulated agent conversations, so every visitor gets a clean demo.
5. **Tracking** — fire `demo_viewed` and `demo_to_signup` via the existing analytics wrapper
   (plan 62), so the demo's conversion contribution is measurable.

### Key files
- New: `apps/landing/src/pages/demo.astro`.
- Edit: `apps/landing/src/components/Hero.astro` and/or `FinalCta.astro` (CTA target);
  `layouts/Base.astro` (meta for `/demo` via plan 69).
- Dashboard side (verify exact modules): demo/read-only role + control-tool gating; a demo
  reset job.
- Infra (not app code): the sample ClickHouse deployment + credentials (kept out of the repo;
  configured via env/secrets).

### Open questions (resolve during discovery)
- **Demo cluster hosting:** where does the sample ClickHouse live (managed CH service, a
  small self-hosted node, ClickHouse-provided public dataset endpoint), and who owns its
  cost/uptime? This decision gates everything else — surface it before building UI.
- **Session model:** shared read-only account vs. ephemeral per-visitor session — which does
  the current auth/edition model support with the least new code, while still disabling
  control tools?
- **Embedding vs. linking:** can the dashboard be safely iframed on `/demo`, or should the
  CTA open the dashboard in a new tab? (CSP/frame-ancestors + auth cookies decide this.)
- **Abuse controls:** rate limiting + query timeouts on the demo endpoint so a visitor can't
  hammer the sample cluster.

## STOP conditions & drift check

- STOP before exposing any demo session if control tools / kill-query / DDL are not provably
  disabled for the demo role — a read-only guarantee is non-negotiable.
- STOP if standing up the demo cluster requires committing credentials to the repo — keep
  them in secrets/env only.
- DRIFT: if there is no clean way to disable control tools per-session, do NOT weaken the
  global gate; surface the gap and scope the demo to a deployment where controls are off.
- Do NOT fake panels to fill the demo; hide surfaces that aren't demo-safe.

## Verification

```
cd apps/landing && bun install --frozen-lockfile && bun run build
```

- Confirm `demo.astro` builds and the hero / final CTA link resolves to `/demo`.
- Manually confirm (staging) the demo session is read-only: kill-query and any DDL/control
  action are unavailable, and the agent only *recommends*.
- Confirm `demo_viewed` / `demo_to_signup` events fire through the existing analytics wrapper
  (and are suppressed under DNT).

## Done criteria

- `/demo` page + a "See a live demo" CTA in the hero/final CTA are live and build green.
- The demo renders queries / agent / topology / health over real sample data, read-only, with
  no destructive actions possible.
- Demo state resets periodically; demo→signup conversion is tracked (DNT-respecting).
- No fabricated UI; every visible capability is a shipped feature.

Priority: P1 · Effort: M · Depth: E · Wave: G (Growth) · Lever: Adoption / Revenue

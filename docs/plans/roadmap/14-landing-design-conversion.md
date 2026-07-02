# 14 — Landing Design & Conversion

> Priority: P0 · Effort: M · Risk: LOW · Depends on: none (pricing already derives from `@chm/pricing`); pairs with 13 (overage copy) and 20 (traffic that lands here).
> Category: Growth/Revenue · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

`apps/landing` (Astro static, `chmonitor.dev`) already renders — `src/pages/index.astro` composes `Hero → Features → DataExplorer → Health → Capabilities → SocialProof → Comparison → Pricing → OpenSource → FAQ → FinalCta`, and `components/Pricing.astro` already has an annual-default billing toggle (`data-period="yearly"` is `active` on load) driven by `src/data/pricing.ts` (which derives from `@chm/pricing`, so it can't drift). Good bones. But it doesn't yet *convert*:

- **The wedge isn't the headline.** The positioning that wins — "pganalyze for ClickHouse, works everywhere ClickHouse runs, with an AI ops agent" — isn't the first thing a visitor reads. Hero copy is generic.
- **Weak social proof.** `SocialProof.astro` exists but doesn't lead with the strongest, verifiable asset: chmonitor is **cited in ClickHouse's own documentation**. That's a credibility bomb we're not detonating above the fold.
- **The recommended tier isn't obvious enough.** `pricing.ts` marks Pro `highlight: true`, but a good/better/best page converts far better when the recommended column is visually unmissable and the annual saving is framed as concrete money ("2 months free"), not a percentage.
- **No overage story.** Plan 13 introduces per-host + AI overage; the pricing page must explain "your tier includes N hosts; extra hosts are $17/mo each" so the pricing is honest and the expansion path is legible.
- **No conversion instrumentation.** We can't tell which section or CTA converts. The telemetry worker (`apps/telemetry`) exists for install pings but the landing has no privacy-friendly CTA-click / scroll-depth signal.

## Goal

**A first-time visitor sees the wedge + "cited in ClickHouse's docs" above the fold, an annual-default 3-tier pricing block with an unmistakable recommended tier and honest overage copy, and every primary CTA click is measurable — verified by a build that passes and a link/lint check.** (Measurable acceptance: `astro build` succeeds, `astro check` / link-check passes, and a snapshot test asserts the hero contains the wedge string and the ClickHouse-docs proof.)

## Design

All changes are in `apps/landing/src` (standalone Astro install — its own `bun install`, `bun run build`). No dashboard changes. Pricing numbers keep flowing from `@chm/pricing` via `src/data/pricing.ts`; only copy/layout/proof change.

### A. Hero rewrite (`components/Hero.astro`)

Lead with the wedge. Concrete copy:

- **H1:** "The AI ops agent for ClickHouse — everywhere it runs."
- **Sub:** "pganalyze-grade monitoring for ClickHouse: slow queries, merges, replication lag, and a resident AI that tells you *why* — self-hosted free, or fully managed. Works on ClickHouse OSS, Altinity, and Cloud."
- **Primary CTA:** "Start free" → `https://dash.chmonitor.dev` (matches `DASH` in `pricing.ts`). **Secondary CTA:** "Self-host in 2 min" → docs quickstart.
- Proof strip directly under CTAs (small, muted): "Cited in the ClickHouse documentation · GPL-3.0 open source · ⭐ N on GitHub".

### B. Social proof (`components/SocialProof.astro`)

Make the ClickHouse-docs citation the hero of this section: a card/quote block "Referenced in ClickHouse's official documentation" with a link to the exact doc page/PR that cites chmonitor (agent must find and paste the real URL — do not fabricate; if unverifiable, downgrade copy to "Built on ClickHouse's own system tables" and open an issue to source the citation). Add GitHub stars (fetched at build time or hardcoded + a follow-up to auto-update) and a one-line testimonial slot.

### C. Pricing page (`components/Pricing.astro` + `src/pages/pricing.astro`)

- **Keep the annual-default toggle** (already correct). Ensure "Yearly" tab shows the struck-through monthly price and "$X/yr · save {N months} free" (already implemented — verify the copy reads "2 months free" given the 10×-monthly ratio via `yearlyMonthsFreeValue`).
- **Recommended tier = Pro, unmistakable.** Add a "Most popular" ribbon + elevated card (border, shadow, scale) driven by the existing `highlight` flag in `pricing.ts` PRESENTATION. Good/better/best reading order Free → **Pro** → Max, Enterprise as a 4th "Contact us" column.
- **Overage copy (new, honest).** Under each paid card's host/AI rows add a muted line derived from `@chm/pricing`: "Includes {hosts} hosts — extra hosts $17/mo" and "Includes {aiRequestsPerDay} AI msgs/day — then $5 / 2,000". Source these from the plan object (add `hostOverageUsd` reader in `pricing.ts` once 13 adds the field; until then, a `TODO`-guarded constant so this plan doesn't block on 13).
- Update `pricingFaqs` in `src/data/pricing.ts`: add a "What are host and AI overages?" Q; keep the existing annual-billing and self-host-free answers.

### D. Conversion instrumentation (privacy-friendly)

- Add a tiny inline script that POSTs a `landing_cta` event to the existing telemetry collector shape (or a new `POST /v1/event` name if `apps/telemetry` EVENTS set is extended — coordinate: it currently only accepts a closed enum, so add `landing_cta_click` to `EVENTS` in `apps/telemetry/src/index.ts` and mirror in the dashboard's `TELEMETRY_EVENTS` doc). No cookies, no PII — just an aggregate counter keyed by CTA id (`hero_start_free`, `pricing_pro`, etc.). Respect `DO_NOT_TRACK`.
- If wiring telemetry is out of appetite, fall back to a documented Plausible/Cloudflare-Web-Analytics snippet gated behind an env flag — but prefer reusing the owned collector.

### E. Snapshot / structure guard

Add `apps/landing/test/hero.test.ts` (Bun test on the compiled component / rendered HTML) asserting the hero HTML contains the wedge phrase and "ClickHouse documentation", and that the pricing block marks exactly one tier as highlighted. This is the "real test" (below).

## Steps

1. **[S] Hero rewrite.** Update `components/Hero.astro` H1/sub/CTAs + proof strip per A. Keep existing styles/tokens (`Base.astro` theme vars).
2. **[S] Social proof.** Rework `components/SocialProof.astro` per B; find + paste the real ClickHouse-docs citation URL (verify via web fetch of the ClickHouse docs/GitHub); add stars line.
3. **[M] Pricing conversion polish.** In `components/Pricing.astro`: add "Most popular" ribbon + elevated Pro card from the `highlight` flag; verify annual-default toggle + "2 months free" copy; add overage lines sourced from the plan object; extend `pricingFaqs` in `data/pricing.ts`. **Split: (a) recommended-tier visual; (b) overage copy + FAQ; (c) verify toggle/annual math renders.**
4. **[S] Conversion events.** Add `landing_cta_click` to `apps/telemetry/src/index.ts` EVENTS enum; add the inline CTA-click POST in the landing (respecting DO_NOT_TRACK); document in `apps/telemetry/README.md`.
5. **[S] Structure guard test.** Add `apps/landing/test/hero.test.ts` asserting wedge string, ClickHouse-docs proof, and single highlighted tier.
6. **[XS] Link/lint pass.** Run `astro check` + a link-check over built HTML; fix any broken internal links (docs quickstart, dash URL).

## Real test

`apps/landing/test/hero.test.ts` (Bun test, fails today, passes after):

- Rendered `index` HTML contains the wedge substring (`AI ops agent for ClickHouse` / "everywhere it runs") — fails today (generic hero).
- Rendered HTML contains "ClickHouse documentation" in the social-proof region — fails today.
- Exactly one pricing tier carries the highlight/`Most popular` marker — guards against future drift.

Acceptance artifact for the non-code parts: a passing `astro build` + link-check (`bun run build` in `apps/landing` produces `dist/` with no broken internal links), recorded in the PR.

## Verification

```bash
cd apps/landing
bun install
bun run build                 # astro build → dist/, no errors
bunx astro check              # type/diagnostics clean
bun test test/hero.test.ts    # structure guard green
# link-check the built output (e.g. `bunx linkinator dist --recurse --silent` or repo's checker)
cd ../telemetry && bun run build   # EVENTS enum change compiles
```

## Out of scope / STOP conditions

- **Do not change pricing numbers or plan semantics** — those live in `packages/pricing/src/plans.ts` (plan 13 owns money changes). This plan only changes copy, layout, proof, and instrumentation.
- **Do not fabricate the ClickHouse-docs citation.** If the exact citing page can't be verified via a real fetch, downgrade the claim and file an issue — never assert an unverifiable endorsement.
- No dashboard/auth changes; landing is a standalone Astro app.
- No third-party tracker that sets cookies or collects PII; instrumentation stays aggregate + DO_NOT_TRACK-respecting.
- Don't touch OSS/self-host defaults or the docs' free-forever framing.

## Done

- [ ] Hero leads with the wedge + "cited in ClickHouse's docs" proof strip.
- [ ] Social-proof section leads with the (verified) ClickHouse-docs citation.
- [ ] Pricing: annual-default toggle confirmed, Pro visually unmistakable, honest overage copy, FAQ updated.
- [ ] CTA-click events flow to the telemetry collector (or documented fallback), DO_NOT_TRACK respected.
- [ ] `apps/landing/test/hero.test.ts` green; `astro build` + link-check clean.
- [ ] Status row for **14** updated in `plans/roadmap/README.md`.

# 68 — GitHub star social proof

## Kickoff prompt

```text
Execute plans/68-github-star-social-proof.md ALONE (do not read other plans).
Goal: add a prominent GitHub-star CTA to the landing — a star badge in the hero and
a mid-page "building in public, star us" card — showing a live star count fetched at
BUILD time, with click tracking and zero layout shift.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: landing marketing only; no app/runtime/billing change.
- Marketing claims MUST match reality: show the ACTUAL star count. If the build-time
  fetch fails, fall back to the badge WITHOUT a fabricated number (or a static
  "Star on GitHub" label) — never invent a count.
- Analytics/DNT: track star-CTA clicks via the existing analytics wrapper (plan 62);
  respect DNT; no PII.
- Postgres/multi-DB: NO (not relevant here; keep the invariant visible).
- No layout shift (CLS): reserve space for the count/badge so it does not reflow.

When done, run the Verification block at the bottom and paste the output.
```

## Current reality (audited)

Why (roadmap §4/68, P2/S/F): chmonitor is open-core, but the landing has **no prominent
GitHub-star CTA**, forgoing cheap OSS social proof and discoverability. There is a
`SocialProof.astro` component and an `OpenSource.astro` section, but no star badge/count or
"star us" affordance in the hero or mid-page.

Pointers (verify at head):
- Hero: `apps/landing/src/components/Hero.astro` — badge placement (near the primary CTA).
- Existing social-proof surfaces: `components/SocialProof.astro`, `components/OpenSource.astro`
  — natural home / neighbor for the mid-page card.
- Astro pages are static-built, so a **build-time** fetch of the GitHub star count is the
  right mechanism (no client-side API call, no rate-limit exposure, no runtime dependency).
- Analytics wrapper from plan 62 `(verify present)` for click tracking.

## Implement now (depth F — file-level)

### A. Build-time star count
- Fetch the repo's stargazer count from the GitHub REST API at build time (inside the Astro
  component frontmatter or an Astro config/data step), e.g. `GET /repos/{owner}/{repo}` →
  `stargazers_count`. Read owner/repo from a shared constant/env, not hard-coded in two
  places.
- **Honest fallback:** wrap the fetch in try/catch; on failure render the star CTA with **no
  number** (or a plain "Star on GitHub" label). Never render a placeholder/fake count.
- Optionally format large counts (e.g. `1.2k`) but keep the raw number truthful.

### B. Hero star badge — `components/Hero.astro`
- Add a compact "★ Star on GitHub — {count}" badge/link near the hero CTAs, linking to the
  repo. Keep it secondary to the primary product CTA (and to the "See a live demo" CTA from
  plan 60 — don't crowd them).
- **Reserve space** for the count so a slow/failed fetch does not shift layout (fixed min-width
  or skeleton), satisfying the no-CLS invariant.

### C. Mid-page star card
- Add a mid-landing card ("We're building chmonitor in public — star the repo") either as a
  new `components/StarCta.astro` placed in `index.astro`, or folded into `OpenSource.astro`
  `(verify which is cleaner)`. Reuse the same build-time count value (compute once, pass
  down) rather than fetching twice.

### D. Click tracking
- Fire a `github_star_cta_clicked` event (with a `placement: hero | midpage` property) via the
  existing analytics wrapper on click; DNT-respecting, no PII.

## STOP conditions & drift check

- STOP if a star badge/count already exists — reconcile instead of duplicating.
- STOP and use the honest fallback (no number) if the build-time fetch fails or is rate
  limited; do NOT ship a hard-coded/fake count.
- DRIFT: if `SocialProof.astro`/`OpenSource.astro` already fetch repo stats, reuse that data
  path instead of adding a second GitHub fetch.
- Fetch the count **once** at build and share it; do not fetch client-side at runtime.

## Verification

```
cd apps/landing && bun install --frozen-lockfile && bun run build
```

- Confirm the build succeeds both when the GitHub fetch resolves and when it fails (simulate
  by temporarily pointing at an invalid repo/offline) — the failing case must still build and
  render the CTA with no fabricated number.
- Inspect built HTML: the hero badge and mid-page card are present, link to the repo, and the
  count area has reserved space (no reflow).
- Confirm `github_star_cta_clicked` is wired through the existing analytics wrapper.

## Done criteria

- Star CTA appears in the hero **and** as a mid-landing card, linking to the repo.
- The star count is fetched once at build time, shown truthfully, and falls back to a
  number-free CTA on fetch failure.
- Clicks are tracked with a `placement` property (DNT-respecting); no layout shift.
- `apps/landing` `bun run build` is green.

Priority: P2 · Effort: S · Depth: F · Wave: G (Growth) · Lever: Adoption / OSS
